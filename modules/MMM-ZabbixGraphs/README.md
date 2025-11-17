# MMM-ZabbixGraphs

`MMM-ZabbixGraphs` renders PNG graphs exported from Zabbix inside MagicMirror². The module authenticates against the Zabbix JSON-RPC API, retrieves metadata with `graph.get`/`graphitem.get`, downloads the rendered PNG from the web frontend and refreshes it periodically.

## Installation

1. Change into your MagicMirror `modules` directory and clone/copy this folder:
   ```bash
   cd ~/MagicMirror/modules
   git clone <this repo> MMM-ZabbixGraphs
   cd MMM-ZabbixGraphs
   npm install
   ```
2. Restart MagicMirror after editing your configuration.

## Configuration

Add the module to your `config.js`:

```js
{
  module: "MMM-ZabbixGraphs",
  position: "top_left",
  config: {
    zabbixUrl: "https://zabbix.example.com/zabbix",
    // Either keep username/password for legacy releases ...
    username: "api-user",
    password: "superSecret",
    // ...or drop the credentials above and provide an API token (Zabbix >= 7.2)
    // apiToken: "eyJra...",
    graphId: 12345,
    width: 800,
    height: 300,
    refreshMinutes: 5
  }
}
```

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `zabbixUrl` | `string` | `http://localhost/zabbix` | Base URL of your Zabbix frontend. The helper automatically appends `api_jsonrpc.php` for API calls and `chart2.php` for graph downloads. |
| `username` | `string` | `""` | Zabbix username that is allowed to access the graph. Optional when `apiToken` is set. |
| `password` | `string` | `""` | Password for the user above. Optional when `apiToken` is set. |
| `apiToken` | `string` | `""` | Bearer token generated via **Administration → API → Tokens** (Zabbix 7.2+). When present the helper skips `user.login` and authenticates every request (including PNG downloads) via `Authorization: Bearer`. |
| `graphId` | `number` | `null` | ID of the Zabbix graph to display (find it in the URL while viewing the graph inside Zabbix). |
| `width` | `number` | `600` | Width in pixels used when requesting the PNG via `chart2.php`. |
| `height` | `number` | `300` | Height in pixels used for the PNG request. |
| `refreshMinutes` | `number` | `5` | Interval, in minutes, between refreshes. Each refresh reuses the cached auth token and requests a new PNG. Use `refreshInterval` (milliseconds) for backwards compatibility. |

### Finding the `graphId`

1. Open the graph in the Zabbix web UI.
2. Look at the browser address bar; the `graphid=<ID>` query parameter is the numeric value to place in the MagicMirror config.
3. Alternatively, open **Administration → API → Explore**, run `graph.get`, and copy the `graphid` from the response.

Once you have the numeric ID, copy it into the module configuration shown above. If you need to render multiple graphs on your mirror you can either:

- Add multiple `MMM-ZabbixGraphs` entries to `config.js`, each with its own `graphId`, dimensions, and `refreshMinutes`.
- Or duplicate an existing module block and adjust only the fields that change per graph (e.g., `graphId`, `width`, `height`).

Each module instance sends the configured `graphId`, `width`, `height`, and refresh interval to the helper which then calls `graph.get` and downloads the PNG matching that specific configuration.

### Authentication & Error Handling

- On Zabbix 7.2+ you can place a long-lived API token in `config.apiToken`. The helper sends it via both `Authorization: Bearer <token>` and `X-Auth-Token` headers for every JSON-RPC call as well as the `chart2.php` PNG download, so a web session is never created or cached.
- Without `apiToken` the helper falls back to `user.login` using the configured `username`/`password`. The returned session token is cached per `zabbixUrl`/`username` and cleared automatically when Zabbix asks for a new login.
- API responses are validated for HTTP and JSON-RPC errors. Any issue is sent back to the front-end where it is rendered as an error message instead of an image.
- Image downloads happen through the Zabbix frontend (`chart2.php`). The helper either sets the `auth=<session>` query parameter (password flow) or reuses the bearer headers described above (token flow).

### Creating an API Token (Zabbix 7.2+)

1. Sign in to the Zabbix web UI as an administrator and open **Administration → API → Tokens**.
2. Click **Create token**, pick the user the MagicMirror module should impersonate, and give the token a descriptive name.
3. (Optional) Set an expiration date that matches your rotation policy. You can leave it empty for a non-expiring token.
4. Click **Add** and copy the newly generated token string. This value is shown only once—store it safely.
5. Place the copied string into `config.apiToken`. Leave `username`/`password` blank (or remove them) to ensure the helper always uses the bearer token.

### Falling Back to Password Authentication

Older Zabbix versions (≤ 7.0) do not expose the API token UI. In that case keep using `username`/`password`. The helper still caches the session token and only sends the password to `user.login` when necessary. Once you upgrade to 7.2 you can switch to tokens without changing anything else in your module configuration.

### Debugging Tips

- Run MagicMirror with `npm start dev` to see console output. Any API errors logged by the helper will show up there.
- Ensure the user has permission to view the chosen `graphId`. A `Graph was not found` error usually indicates missing rights or a typo in the ID.

## How it Works

1. `MMM-ZabbixGraphs.js` schedules periodic refreshes and requests data from the helper.
2. `node_helper.js` authenticates through the JSON-RPC API.
3. `graph.get` and `graphitem.get` are used to validate access and surface metadata.
4. The PNG is downloaded via `chart2.php` and base64-encoded before being sent back to the browser.

