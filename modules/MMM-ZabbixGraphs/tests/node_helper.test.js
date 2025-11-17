jest.mock("node-fetch");

const fetch = require("node-fetch");
const helper = require("../node_helper");

describe("node_helper graph fetching", () => {
  const config = {
    zabbixUrl: "https://example.com/zabbix",
    username: "demo",
    password: "secret",
    graphId: 321,
    width: 400,
    height: 200
  };
  const authKey = `${config.zabbixUrl}|${config.username}`;

  beforeEach(() => {
    jest.clearAllMocks();
    helper.authTokens = {};
    helper.graphMetadataCache = {};
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("fetchGraphImage throws when the payload is not a PNG", async () => {
    const htmlBuffer = Buffer.from("<html>expired</html>");
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: () => "text/html; charset=utf-8"
      },
      arrayBuffer: async () => htmlBuffer
    });

    await expect(helper.fetchGraphImage(config, "fakeAuth"))
      .rejects.toMatchObject({
        authResetKey: authKey,
        userMessage: expect.stringContaining("re-authenticate")
      });
  });

  test("handleGraphRequest emits cached metadata and the fetched image when Zabbix responds", async () => {
    const cacheKey = helper.getGraphCacheKey(config);
    const graphItems = [
      { itemid: 1, color: "FF0000" },
      { itemid: 2, color: "00FF00" }
    ];
    const pngBuffer = Buffer.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0x00,
      0x00,
      0x00,
      0x0d
    ]);
    const pngBase64 = pngBuffer.toString("base64");

    const buildJsonResponse = result => ({
      ok: true,
      status: 200,
      json: async () => ({ result })
    });
    const buildImageResponse = () => ({
      ok: true,
      status: 200,
      headers: {
        get: name => {
          if (name && name.toLowerCase() === "content-type") {
            return "image/png";
          }
          return null;
        }
      },
      arrayBuffer: async () => pngBuffer
    });

    helper.sendSocketNotification = jest.fn();

    fetch.mockImplementation((url, options = {}) => {
      if (url.includes("api_jsonrpc.php")) {
        const payload = JSON.parse(options.body);
        if (payload.method === "user.login") {
          return buildJsonResponse("authToken123");
        }
        if (payload.method === "graph.get") {
          return buildJsonResponse([{ graphid: config.graphId, name: "CPU Usage" }]);
        }
        if (payload.method === "graphitem.get") {
          return buildJsonResponse(graphItems);
        }
        throw new Error(`Unexpected API method ${payload.method}`);
      }
      if (url.includes("chart2.php")) {
        return buildImageResponse();
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    await helper.handleGraphRequest(config);

    expect(helper.graphMetadataCache[cacheKey]).toEqual({
      title: "CPU Usage",
      items: graphItems
    });
    expect(helper.sendSocketNotification).toHaveBeenCalledWith(
      "GRAPH_RESULT",
      expect.objectContaining({
        title: "CPU Usage",
        graphId: config.graphId,
        items: graphItems,
        image: pngBase64
      })
    );
  });

  test("handleGraphRequest resolves graphId from a dashboard widget when graphId is omitted", async () => {
    const dashboardConfig = {
      ...config,
      graphId: null,
      dashboardId: 555,
      widgetId: 99
    };
    const resolvedGraphId = 654321;
    const widget = {
      widgetid: String(dashboardConfig.widgetId),
      type: "graph",
      name: "Dashboard CPU",
      fields: [{ name: "graphid.0", value: String(resolvedGraphId) }]
    };
    const graphItems = [{ itemid: 10, color: "AA0000" }];
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const buildJsonResponse = result => ({
      ok: true,
      status: 200,
      json: async () => ({ result })
    });
    const buildImageResponse = () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => pngBuffer
    });

    helper.sendSocketNotification = jest.fn();

    fetch.mockImplementation((url, options = {}) => {
      if (url.includes("api_jsonrpc.php")) {
        const payload = JSON.parse(options.body);
        switch (payload.method) {
          case "user.login":
            return buildJsonResponse("authTokenXYZ");
          case "dashboard.get":
            return buildJsonResponse([
              {
                dashboardid: dashboardConfig.dashboardId,
                pages: [
                  {
                    dashboard_pageid: 1,
                    widgets: [widget]
                  }
                ]
              }
            ]);
          case "graph.get":
            expect(payload.params.graphids).toEqual([resolvedGraphId]);
            return buildJsonResponse([{ graphid: resolvedGraphId, name: "CPU Usage" }]);
          case "graphitem.get":
            return buildJsonResponse(graphItems);
          default:
            throw new Error(`Unexpected API method ${payload.method}`);
        }
      }
      if (url.includes("chart2.php")) {
        expect(url).toContain(`graphid=${resolvedGraphId}`);
        return buildImageResponse();
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    await helper.handleGraphRequest(dashboardConfig);

    expect(helper.sendSocketNotification).toHaveBeenCalledWith(
      "GRAPH_RESULT",
      expect.objectContaining({
        title: "Dashboard CPU",
        graphId: resolvedGraphId,
        items: graphItems,
        image: pngBuffer.toString("base64")
      })
    );
  });

  test("handleGraphRequest clears cached auth tokens and reports readable errors", async () => {
    helper.sendSocketNotification = jest.fn();
    helper.authTokens[authKey] = "cached";

    jest.spyOn(helper, "authenticate").mockResolvedValue("auth");
    jest
      .spyOn(helper, "callZabbixApi")
      .mockResolvedValueOnce([{ graphid: config.graphId, name: "CPU" }])
      .mockResolvedValueOnce([{ itemid: 1 }]);

    const err = new Error("expired");
    err.authResetKey = authKey;
    err.userMessage = "Graph image unavailable. Please re-authenticate with Zabbix.";
    jest.spyOn(helper, "fetchGraphImage").mockRejectedValue(err);

    await helper.handleGraphRequest(config);

    expect(helper.authTokens[authKey]).toBeUndefined();
    expect(helper.sendSocketNotification).toHaveBeenCalledWith(
      "GRAPH_RESULT",
      expect.objectContaining({
        error: err.userMessage
      })
    );
  });

  describe("request timeouts", () => {
    const setupAbortableFetch = () => {
      fetch.mockImplementation((url, options = {}) => {
        return new Promise((resolve, reject) => {
          const signal = options.signal;
          const rejectWithAbort = () => {
            const abortError = new Error("aborted");
            abortError.name = "AbortError";
            reject(abortError);
          };

          if (!signal) {
            rejectWithAbort();
            return;
          }
          if (signal.aborted) {
            rejectWithAbort();
            return;
          }
          signal.addEventListener("abort", rejectWithAbort);
        });
      });
    };

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test("callZabbixApi rejects with a readable timeout message", async () => {
      setupAbortableFetch();
      const timeoutConfig = { ...config, requestTimeoutMs: 25 };

      const promise = helper.callZabbixApi("graph.get", { graphids: [config.graphId] }, timeoutConfig, "auth");
      jest.advanceTimersByTime(25);

      await expect(promise).rejects.toMatchObject({
        userMessage: expect.stringContaining("Zabbix did not respond"),
        authResetKey: authKey
      });
    });

    test("fetchGraphImage rejects with the timeout userMessage", async () => {
      setupAbortableFetch();
      const timeoutConfig = { ...config, requestTimeoutMs: 30 };

      const promise = helper.fetchGraphImage(timeoutConfig, "auth");
      jest.advanceTimersByTime(30);

      await expect(promise).rejects.toMatchObject({
        userMessage: expect.stringContaining("Zabbix did not respond"),
        authResetKey: authKey
      });
    });
  });

  test("callZabbixApi uses apiToken headers and skips user.login", async () => {
    const tokenConfig = {
      ...config,
      apiToken: " test-token-value "
    };
    const resultPayload = [{ graphid: config.graphId }];

    helper.sendSocketNotification = jest.fn();
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: resultPayload })
    });

    const response = await helper.callZabbixApi(
      "graph.get",
      { graphids: [config.graphId], output: "extend" },
      tokenConfig
    );

    expect(response).toEqual(resultPayload);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, options] = fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer test-token-value");
    expect(options.headers["X-Auth-Token"]).toBe("test-token-value");

    const body = JSON.parse(options.body);
    expect(body.auth).toBeNull();
    expect(body.method).toBe("graph.get");
  });

  test("resolveGraphReference rejects when no graph or dashboard information is provided", async () => {
    await expect(helper.resolveGraphReference({}, null)).rejects.toMatchObject({
      message: expect.stringContaining("Missing graphId")
    });
  });

  test("extractGraphIdFromWidget understands graphid.* fields", () => {
    const widget = {
      fields: [
        { name: "ignored", value: 1 },
        { name: "graphid.0", value: "987" }
      ]
    };

    expect(helper.extractGraphIdFromWidget(widget)).toBe(987);
  });
});
