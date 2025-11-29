const NodeHelper = require("node_helper");
const fetch = require("node-fetch");

module.exports = NodeHelper.create({
  start() {
    this.authTokens = {};
    this.graphMetadataCache = {};
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "GET_GRAPH") {
      this.handleGraphRequest(payload);
    }
  },

  async handleGraphRequest(config) {
    let cacheKey = null;
    try {
      const auth = await this.authenticate(config);
      const { graphId, widgetTitle, widgetTimeConfig, widgetDimensions } =
        await this.resolveGraphReference(config, auth);
      const effectiveConfig = { ...config, ...widgetTimeConfig, ...widgetDimensions, graphId };
      cacheKey = this.getGraphCacheKey(effectiveConfig);
      let metadata = cacheKey ? this.graphMetadataCache[cacheKey] : null;
      if (!metadata) {
        metadata = await this.fetchGraphMetadata(effectiveConfig, auth);
      }

      if (widgetTitle && widgetTitle !== metadata.title) {
        metadata = { ...metadata, title: widgetTitle };
      }

      if (cacheKey) {
        this.graphMetadataCache[cacheKey] = metadata;
      }

      const image = await this.fetchGraphImage(effectiveConfig, auth);

      this.sendSocketNotification("GRAPH_RESULT", {
        title: metadata.title,
        graphId,
        width: effectiveConfig.width,
        height: effectiveConfig.height,
        items: metadata.items,
        image
      });
    } catch (error) {
      console.error(
        `[MMM-ZabbixGraphs] Failed to load graph ${config.graphId || "unknown"}: ${error.message}`
      );
      if (error.logDetails) {
        console.error("[MMM-ZabbixGraphs] Details:", error.logDetails);
      }
      if (error.authResetKey) {
        delete this.authTokens[error.authResetKey];
      }
      if (cacheKey && (error.authResetKey || error.invalidateGraphCache)) {
        delete this.graphMetadataCache[cacheKey];
      }
      this.sendSocketNotification("GRAPH_RESULT", {
        error: error.userMessage || error.message || "Unknown error"
      });
    }
  },

  async fetchGraphMetadata(config, auth) {
    const graph = await this.callZabbixApi(
      "graph.get",
      {
        graphids: [config.graphId],
        output: "extend"
      },
      config,
      auth
    );

    if (!graph || graph.length === 0) {
      const err = new Error(`Graph ${config.graphId} was not found`);
      err.invalidateGraphCache = true;
      throw err;
    }

    const items = await this.callZabbixApi(
      "graphitem.get",
      {
        graphids: [config.graphId],
        output: "extend"
      },
      config,
      auth
    );

    return {
      title: graph[0].name,
      items
    };
  },

  async authenticate(config) {
    if (this.usesApiToken(config)) {
      return null;
    }

    if (!config.username || !config.password) {
      throw new Error("Missing username/password or apiToken in configuration");
    }

    const key = this.getAuthKey(config);
    if (this.authTokens[key]) {
      return this.authTokens[key];
    }

    const response = await this.callZabbixApi(
      "user.login",
      {
        user: config.username,
        password: config.password
      },
      config
    );

    if (!response) {
      throw new Error("Zabbix authentication failed");
    }

    this.authTokens[key] = response;
    return response;
  },

  getAuthKey(config) {
    const username = typeof config.username === "string" ? config.username : "";
    return `${config.zabbixUrl}|${username}`;
  },

  async callZabbixApi(method, params, config, authToken) {
    const apiUrl = this.getApiUrl(config.zabbixUrl);
    const useToken = this.usesApiToken(config);
    const { controller, dispose } = this.createTimeoutController(config);
    const body = {
      jsonrpc: "2.0",
      method,
      params,
      id: Date.now(),
      auth: useToken ? null : authToken || null
    };

    const headers = {
      "Content-Type": "application/json-rpc"
    };

    if (useToken) {
      const token = config.apiToken.trim();
      headers.Authorization = `Bearer ${token}`;
      headers["X-Auth-Token"] = token;
    }

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const err = new Error(`Zabbix API HTTP ${response.status}`);
        if (!useToken) {
          err.authResetKey = this.getAuthKey(config);
        }
        throw err;
      }

      const data = await response.json();
      if (data.error) {
        const err = new Error(data.error.message || "Unknown Zabbix API error");
        if (!useToken && data.error.data && data.error.data.includes("re-login")) {
          err.authResetKey = this.getAuthKey(config);
        }
        throw err;
      }

      return data.result;
    } catch (error) {
      if (error.name === "AbortError") {
        throw this.buildTimeoutError(config);
      }
      throw error;
    } finally {
      dispose();
    }
  },

  async fetchGraphImage(config, authToken) {
    const baseUrl = this.getBaseUrl(config.zabbixUrl);
    const chartUrl = new URL("chart2.php", baseUrl);
    chartUrl.searchParams.set("graphid", config.graphId);
    chartUrl.searchParams.set("width", config.width || 600);
    chartUrl.searchParams.set("height", config.height || 300);
    if (typeof config.period === "number" && config.period > 0) {
      chartUrl.searchParams.set("period", config.period);
    }
    if (typeof config.stime === "string" && config.stime.trim().length > 0) {
      chartUrl.searchParams.set("stime", config.stime.trim());
    }
    if (typeof config.timeShift === "string" && config.timeShift.trim().length > 0) {
      chartUrl.searchParams.set("timeshift", config.timeShift.trim());
    }
    if (!this.usesApiToken(config) && authToken) {
      chartUrl.searchParams.set("auth", authToken);
    }

    const headers = {};
    if (this.usesApiToken(config)) {
      const token = config.apiToken.trim();
      headers.Authorization = `Bearer ${token}`;
      headers["X-Auth-Token"] = token;
    }

    const { controller, dispose } = this.createTimeoutController(config);
    let response;
    try {
      response = await fetch(chartUrl.toString(), { headers, signal: controller.signal });
    } catch (error) {
      if (error.name === "AbortError") {
        throw this.buildTimeoutError(config);
      }
      throw error;
    } finally {
      dispose();
    }
    if (!response.ok) {
      throw new Error(`Unable to download graph image (${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const pngSignature = buffer.slice(0, 4);
    const looksLikePng =
      pngSignature.length === 4 &&
      pngSignature[0] === 0x89 &&
      pngSignature[1] === 0x50 &&
      pngSignature[2] === 0x4e &&
      pngSignature[3] === 0x47;

    if (!contentType.includes("image/png") || !looksLikePng) {
      const snippet = buffer
        .slice(0, 120)
        .toString("utf8")
        .replace(/\s+/g, " ")
        .trim();

      console.warn(
        `[MMM-ZabbixGraphs] Expected a PNG from chart2.php but received ${
          contentType || "an unknown content-type"
        } (status ${response.status}).`
      );
      if (snippet) {
        console.warn(`[MMM-ZabbixGraphs] Response preview: ${snippet}`);
      }

      const err = new Error("Zabbix returned an unexpected response while fetching the graph image");
      err.userMessage =
        "Graph image unavailable. Please re-authenticate with Zabbix to refresh your session.";
      err.logDetails = {
        status: response.status,
        contentType: contentType || "unknown",
        responsePreview: snippet
      };
      if (!this.usesApiToken(config)) {
        err.authResetKey = this.getAuthKey(config);
      }
      throw err;
    }

    return buffer.toString("base64");
  },

  getBaseUrl(zabbixUrl) {
    if (!zabbixUrl) {
      throw new Error("Missing Zabbix URL in configuration");
    }
    return zabbixUrl.endsWith("/") ? zabbixUrl : `${zabbixUrl}/`;
  },

  getApiUrl(zabbixUrl) {
    const base = this.getBaseUrl(zabbixUrl);
    const api = new URL("api_jsonrpc.php", base);
    return api.toString();
  },

  getGraphCacheKey(config) {
    if (!config || !config.graphId) {
      return null;
    }
    const base = this.getBaseUrl(config.zabbixUrl || "");
    return `${base}|${config.graphId}`;
  },

  async resolveGraphReference(config = {}, auth) {
    if (this.normalizeNumericId(config.graphId) !== null) {
      const err = new Error("Use dashboard widgets instead of direct graph IDs");
      err.userMessage = err.message;
      throw err;
    }

    if (this.normalizeNumericId(config.dashboardId) !== null) {
      return this.fetchDashboardGraph(config, auth);
    }

    const err = new Error("Missing dashboardId and widget selection in configuration");
    err.userMessage = err.message;
    throw err;
  },

  async fetchDashboardGraph(config, auth) {
    const dashboardId = this.normalizeNumericId(config.dashboardId);
    if (dashboardId === null) {
      const err = new Error("Missing dashboardId in configuration");
      err.userMessage = err.message;
      throw err;
    }

    const dashboards = await this.callZabbixApi(
      "dashboard.get",
      {
        dashboardids: [dashboardId],
        selectPages: ["dashboard_pageid", "widgets"]
      },
      config,
      auth
    );

    if (!Array.isArray(dashboards) || dashboards.length === 0) {
      const err = new Error(`Dashboard ${dashboardId} was not found or you lack permission to view it`);
      err.userMessage = err.message;
      throw err;
    }

    const dashboard = dashboards[0];
    const widgets = this.collectDashboardWidgets(dashboard);
    if (widgets.length === 0) {
      const err = new Error(`Dashboard ${dashboardId} does not contain any widgets you can access`);
      err.userMessage = err.message;
      throw err;
    }

    const widget = this.pickDashboardWidget(widgets, config);
    if (!widget) {
      const err = new Error(`No matching graph widget was found on dashboard ${dashboardId}`);
      err.userMessage = err.message;
      throw err;
    }

    const graphId = this.extractGraphIdFromWidget(widget);
    if (graphId === null) {
      const err = new Error("The selected dashboard widget does not reference a graph");
      err.userMessage = err.message;
      throw err;
    }

    const widgetTitle = typeof widget.name === "string" && widget.name.trim().length > 0 ? widget.name.trim() : null;
    const widgetTimeConfig = this.extractWidgetTimeConfig(widget);
    const widgetDimensions = this.extractWidgetDimensions(widget, config);
    return { graphId, widgetTitle, widgetTimeConfig, widgetDimensions };
  },

  collectDashboardWidgets(dashboard = {}) {
    const widgets = [];
    const pages = Array.isArray(dashboard.pages) ? dashboard.pages : [];
    pages.forEach(page => {
      if (Array.isArray(page.widgets)) {
        page.widgets.forEach(widget => widgets.push(widget));
      }
    });
    return widgets;
  },

  pickDashboardWidget(widgets = [], config = {}) {
    if (!Array.isArray(widgets) || widgets.length === 0) {
      return null;
    }

    const widgetId = config.widgetId !== undefined && config.widgetId !== null ? String(config.widgetId) : null;
    if (widgetId) {
      const exactMatch = widgets.find(widget => String(widget.widgetid) === widgetId);
      if (exactMatch) {
        return exactMatch;
      }
    }

    const widgetName = typeof config.widgetName === "string" ? config.widgetName.trim() : "";
    if (widgetName) {
      const nameMatch = widgets.find(widget => typeof widget.name === "string" && widget.name.trim() === widgetName);
      if (nameMatch) {
        return nameMatch;
      }
    }

    return widgets.find(widget => this.isGraphWidget(widget)) || null;
  },

  isGraphWidget(widget) {
    if (!widget || typeof widget.type !== "string") {
      return false;
    }
    const type = widget.type.toLowerCase();
    return type === "graph" || type === "graphprototype" || type === "svggraph";
  },

  extractGraphIdFromWidget(widget = {}) {
    if (!widget || !Array.isArray(widget.fields)) {
      return null;
    }

    const graphField = widget.fields.find(field => this.isGraphField(field));
    if (!graphField) {
      return null;
    }

    const value = this.getWidgetFieldValue(graphField);
    return this.normalizeNumericId(value);
  },

  extractWidgetTimeConfig(widget = {}) {
    const timeConfig = {};
    if (!widget || !Array.isArray(widget.fields)) {
      return timeConfig;
    }

    widget.fields.forEach(field => {
      if (!field || typeof field.name !== "string") {
        return;
      }

      const name = field.name.trim().toLowerCase();
      const value = this.getWidgetFieldValue(field);

      if (value === null || value === undefined) {
        return;
      }

      if (name === "time_period" || name.startsWith("time_period.")) {
        const numericValue = Number(value);
        if (Number.isFinite(numericValue)) {
          timeConfig.period = numericValue;
        }
      } else if (name === "time_from" || name.startsWith("time_from.")) {
        const stime = typeof value === "string" ? value.trim() : String(value);
        if (stime.length > 0) {
          timeConfig.stime = stime;
        }
      } else if (name === "time_shift" || name.startsWith("time_shift.")) {
        const timeShift = typeof value === "string" ? value.trim() : String(value);
        if (timeShift.length > 0) {
          timeConfig.timeShift = timeShift;
        }
      }
    });

    return timeConfig;
  },

  extractWidgetDimensions(widget = {}, config = {}) {
    const width = this.normalizeNumericId(widget.width);
    const height = this.normalizeNumericId(widget.height);
    const fallbackWidth = this.normalizeNumericId(config.width);
    const fallbackHeight = this.normalizeNumericId(config.height);

    return {
      width: (width && width > 0 ? width : fallbackWidth) || 600,
      height: (height && height > 0 ? height : fallbackHeight) || 300
    };
  },

  isGraphField(field) {
    if (!field || typeof field.name !== "string") {
      return false;
    }
    const name = field.name.trim();
    return name === "graphid" || name.startsWith("graphid.");
  },

  getWidgetFieldValue(field = {}) {
    if (field.value !== undefined && field.value !== null) {
      return field.value;
    }
    if (field.value_int !== undefined && field.value_int !== null) {
      return field.value_int;
    }
    if (field.value_str !== undefined && field.value_str !== null) {
      return field.value_str;
    }
    return null;
  },

  normalizeNumericId(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  },

  usesApiToken(config) {
    return typeof config.apiToken === "string" && config.apiToken.trim().length > 0;
  },

  getRequestTimeout(config = {}) {
    const value = Number(config.requestTimeoutMs);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
    return 10000;
  },

  createTimeoutController(config = {}) {
    const controller = new AbortController();
    const timeoutMs = this.getRequestTimeout(config);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return {
      controller,
      dispose: () => clearTimeout(timer)
    };
  },

  buildTimeoutError(config = {}) {
    const timeoutMs = this.getRequestTimeout(config);
    const err = new Error(`Zabbix request timed out after ${timeoutMs}ms`);
    const seconds = Math.ceil(timeoutMs / 1000);
    err.userMessage = `Zabbix did not respond within ${seconds} second${seconds === 1 ? "" : "s"}. We'll retry automatically.`;
    if (!this.usesApiToken(config)) {
      err.authResetKey = this.getAuthKey(config);
    }
    return err;
  }
});
