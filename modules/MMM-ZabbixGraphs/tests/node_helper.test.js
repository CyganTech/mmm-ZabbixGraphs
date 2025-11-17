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
});
