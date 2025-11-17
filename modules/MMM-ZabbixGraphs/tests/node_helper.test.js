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
});
