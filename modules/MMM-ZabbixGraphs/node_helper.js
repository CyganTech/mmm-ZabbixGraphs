const NodeHelper = require("node_helper");
const fetch = require("node-fetch");

module.exports = NodeHelper.create({
  start() {
    this.authTokens = {};
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "GET_GRAPH") {
      this.handleGraphRequest(payload);
    }
  },

  async handleGraphRequest(config) {
    try {
      if (!config.graphId) {
        throw new Error("Missing graphId in configuration");
      }

      const auth = await this.authenticate(config);
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
        throw new Error(`Graph ${config.graphId} was not found`);
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

      const image = await this.fetchGraphImage(config, auth);

      this.sendSocketNotification("GRAPH_RESULT", {
        title: graph[0].name,
        graphId: config.graphId,
        items,
        image
      });
    } catch (error) {
      console.error("MMM-ZabbixGraphs error", error);
      if (error.authResetKey) {
        delete this.authTokens[error.authResetKey];
      }
      this.sendSocketNotification("GRAPH_RESULT", {
        error: error.message || "Unknown error"
      });
    }
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

    const response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
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
  },

  async fetchGraphImage(config, authToken) {
    const baseUrl = this.getBaseUrl(config.zabbixUrl);
    const chartUrl = new URL("chart2.php", baseUrl);
    chartUrl.searchParams.set("graphid", config.graphId);
    chartUrl.searchParams.set("width", config.width || 600);
    chartUrl.searchParams.set("height", config.height || 300);
    if (!this.usesApiToken(config) && authToken) {
      chartUrl.searchParams.set("auth", authToken);
    }

    const headers = {};
    if (this.usesApiToken(config)) {
      const token = config.apiToken.trim();
      headers.Authorization = `Bearer ${token}`;
      headers["X-Auth-Token"] = token;
    }

    const response = await fetch(chartUrl.toString(), { headers });
    if (!response.ok) {
      throw new Error(`Unable to download graph image (${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer).toString("base64");
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

  usesApiToken(config) {
    return typeof config.apiToken === "string" && config.apiToken.trim().length > 0;
  }
});
