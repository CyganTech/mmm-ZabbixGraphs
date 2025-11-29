# MMM-ZabbixGraphs

`MMM-ZabbixGraphs` renders PNG graphs exported from Zabbix inside MagicMirror². The module authenticates against the Zabbix JSON-RPC API, resolves a dashboard widget that you maintain in the Zabbix UI, mirrors its stored settings (title, colors, time controls, etc.), downloads the rendered PNG from the web frontend, and refreshes it periodically.

## Installation

1. Change into your MagicMirror `modules` directory and clone/copy this folder. The actual MagicMirror module is inside this repository at `modules/MMM-ZabbixGraphs`, so make sure you change into that subdirectory before installing dependencies:
   ```bash
   cd ~/MagicMirror/modules
   git clone https://github.com/CyganTech/mmm-ZabbixGraphs.git MMM-ZabbixGraphs
   cd MMM-ZabbixGraphs/modules/MMM-ZabbixGraphs
   npm install
   ```
2. Restart MagicMirror after editing your configuration.

### Update

From your MagicMirror checkout, pull the latest changes from the module directory and reinstall dependencies before restarting:

```bash
cd ~/MagicMirror/modules/MMM-ZabbixGraphs/modules/MMM-ZabbixGraphs
git pull # or: git pull origin <branch>
npm install
```

## Configuration

Add the module to your `config.js`:

```js
{
  module: "MMM-ZabbixGraphs",
  position: "top_left",
  config: {
    zabbixUrl: "https://zabbix.example.com/zabbix",
    // Either keep username/password for deployments that prefer session authentication ...
    username: "api-user",
    password: "superSecret",
    // ...or drop the credentials above and provide an API token (validated on Zabbix 7.2)
    // apiToken: "eyJra...",
    // Mirror a dashboard widget configured inside the Zabbix UI.
    dashboardId: 42,
    // Pick a specific widget by ID (recommended) or by matching the title text.
    widgetId: 17,
    // widgetName: "Traffic overview",
    width: 800,
    height: 300,
    refreshMinutes: 5,
    requestTimeoutMs: 10000
  }
}
```

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `zabbixUrl` | `string` | `http://localhost/zabbix` | Base URL of your Zabbix frontend. The helper automatically appends `api_jsonrpc.php` for API calls and `chart2.php` for graph downloads. |
| `username` | `string` | `""` | Zabbix username that is allowed to access the dashboard. Optional when `apiToken` is set. |
| `password` | `string` | `""` | Password for the user above. Optional when `apiToken` is set. |
| `apiToken` | `string` | `""` | Bearer token generated via **Administration → API → Tokens** (validated with Zabbix 7.2). When present the helper skips `user.login` and authenticates every request (including PNG downloads) via `Authorization: Bearer`. |
| `dashboardId` | `number` | `null` | Numeric ID of the dashboard that contains the widget you want to mirror. Required. |
| `widgetId` | `number\|string` | `null` | Optional widget identifier inside the dashboard. When present, the helper resolves that widget and reuses its configured graph. |
| `widgetName` | `string` | `null` | Optional widget title filter used when `widgetId` is not set. The first graph widget whose title matches this string is used. |
| `width` | `number` | `600` | Width in pixels used when requesting the PNG via `chart2.php` (falls back to the widget dimensions when available). |
| `height` | `number` | `300` | Height in pixels used for the PNG request (falls back to the widget dimensions when available). |
| `refreshMinutes` | `number` | `5` | Interval, in minutes, between refreshes. Each refresh reuses the cached auth token and requests a new PNG. Use `refreshInterval` (milliseconds) for backwards compatibility. |
| `requestTimeoutMs` | `number` | `10000` | Milliseconds before JSON-RPC and PNG requests are aborted. When exceeded the helper surfaces a readable error, clears the cached session token, and the module retries on the next scheduled refresh. |

### Mirroring dashboard widgets (no standalone `graphId` support)

The module now relies exclusively on dashboard widgets configured in the Zabbix UI. Instead of pointing at a raw `graphId`, you pick a dashboard and widget to mirror; the helper pulls the widget definition and renders the identical graph with the same colors, time window, and title.

You can find the dashboard ID by opening the dashboard in the Zabbix UI and copying the `dashboardid=<ID>` query parameter from the address bar (`zabbix.php?action=dashboard.view&dashboardid=123`). Widget IDs are shown while editing a dashboard (`widgetid=<ID>` in the URL). If you prefer not to copy URLs manually, the Zabbix API exposes the same details:

**Using an API token**

```bash
curl -X POST "https://zabbix.example.com/zabbix/api_jsonrpc.php"   -H "Content-Type: application/json"   -H "Authorization: Bearer ${ZABBIX_TOKEN}"   -d @- <<'EOF'
{
  "jsonrpc": "2.0",
  "method": "dashboard.get",
  "params": {
    "dashboardids": [123],
    "selectWidgets": ["widgetid", "name", "type", "fields", "width", "height"]
  },
  "id": 1
}
EOF
```

**Using a cached session token from `user.login`**

```bash
curl -X POST "https://zabbix.example.com/zabbix/api_jsonrpc.php"   -H "Content-Type: application/json"   -d @- <<'EOF'
{
  "jsonrpc": "2.0",
  "method": "dashboard.get",
  "params": {
    "dashboardids": [123],
    "selectWidgets": ["widgetid", "name", "type", "fields", "width", "height"]
  },
  "auth": "${ZABBIX_SESSION}",
  "id": 1
}
EOF
```

In the response, the `widgets` array lists each widget. For graph widgets, the `fields` array contains entries such as `graphid`, `timeFrom`, `timeShift`, or a custom `period`. The `width` and `height` values show the dimensions stored by the dashboard layout. Copy the `dashboardid` and `widgetid` into your MagicMirror config to ensure the mirror always renders the exact widget you maintain in the Zabbix UI.

### Authentication & Error Handling

- With an API token (validated on Zabbix 7.2 and available in earlier releases) in `config.apiToken`, the helper sends it via both `Authorization: Bearer <token>` and `X-Auth-Token` headers for every JSON-RPC call as well as the `chart2.php` PNG download, so a web session is never created or cached.
- Without `apiToken` the helper falls back to `user.login` using the configured `username`/`password`. The returned session token is cached per `zabbixUrl`/`username` and cleared automatically when Zabbix asks for a new login.
- API responses are validated for HTTP and JSON-RPC errors. Any issue is sent back to the front-end where it is rendered as an error message instead of an image.
- Every request (JSON-RPC and PNG downloads) inherits the configurable `requestTimeoutMs`. When Zabbix fails to respond in time the helper aborts both calls, clears any cached session token, and surfaces a friendly error so the UI can retry on the next refresh.
- Image downloads happen through the Zabbix frontend (`chart2.php`). The helper either sets the `auth=<session>` query parameter (password flow) or reuses the bearer headers described above (token flow).

### Creating an API Token

1. Sign in to the Zabbix web UI as an administrator and open **Administration → API → Tokens** (location validated on Zabbix 7.2).
2. Click **Create token**, pick the user the MagicMirror module should impersonate, and give the token a descriptive name.
3. (Optional) Set an expiration date that matches your rotation policy. You can leave it empty for a non-expiring token.
4. Click **Add** and copy the newly generated token string. This value is shown only once—store it safely.
5. Place the copied string into `config.apiToken`. Leave `username`/`password` blank (or remove them) to ensure the helper always uses the bearer token.

### Switching Between Token and Password Authentication

API tokens have been available since earlier Zabbix releases and are verified here against 7.2. If you prefer not to use a token (or are constrained by your deployment policy), keep `username`/`password` in the configuration. The helper caches the resulting session token and only sends the password to `user.login` when necessary. You can switch to `apiToken` later without changing any other fields.

### Debugging Tips

- Run MagicMirror with `npm start dev` to see console output. Any API errors logged by the helper will show up there.
- Ensure the user has permission to view the chosen dashboard and widget. A `Dashboard … was not found` error usually indicates missing rights or a typo in the ID.

## Development & Testing

The module includes a Jest suite so you can validate its behavior outside of MagicMirror. The tests simulate Zabbix API calls, expired sessions, dashboard widget resolution, and PNG downloads, ensuring helper changes do not break authentication or graph rendering logic.

```bash
cd modules/MMM-ZabbixGraphs
npm install
npm test
```

The test run displays the mocked API traffic along with any console warnings you would otherwise see in the MagicMirror logs. If you are iterating on UI tweaks, keep `npm start dev` running in your MagicMirror directory to confirm that each module instance refreshes in sync with the helper output.

## How it Works

1. `MMM-ZabbixGraphs.js` schedules periodic refreshes and requests data from the helper.
2. `node_helper.js` authenticates through the JSON-RPC API.
3. `dashboard.get` resolves the configured widget, and `graph.get`/`graphitem.get` validate access and surface metadata.
4. The PNG is downloaded via `chart2.php` and base64-encoded before being sent back to the browser.
