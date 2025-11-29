# MMM-ZabbixGraphs

`MMM-ZabbixGraphs` is a [MagicMirror²](https://magicmirror.builders/) module that renders PNG graphs exported from Zabbix. It authenticates against the Zabbix JSON-RPC API, resolves a dashboard widget configured in the Zabbix UI, and periodically refreshes an image downloaded from `chart2.php`. The helper pulls the widget's graph, title, colors, and time controls so the MagicMirror front-end simply displays the widget exactly as you've configured it.

## Features

- Mirrors any Zabbix dashboard graph widget you can access.
- Supports both username/password logins and API tokens (validated with Zabbix 7.2).
- Periodically refreshes the PNG on a configurable schedule so your mirror always shows the latest data.
- Reuses the widget's **Period**, **From**, and *time shift* controls from the Zabbix UI.
- Surfaces friendly errors in the UI when API calls or PNG downloads fail.

## Installation

1. Change into your MagicMirror `modules` directory and clone/copy this folder. The actual MagicMirror module lives under the nested `modules/MMM-ZabbixGraphs` directory in this repository, so make sure you `cd` into that subfolder before installing dependencies:
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
    username: "api-user",
    password: "superSecret",
    // or: apiToken: "eyJra...",
    dashboardId: 42,
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
| `username` | `string` | `""` | Zabbix username that is allowed to access the widget. Optional when `apiToken` is set. |
| `password` | `string` | `""` | Password for the user above. Optional when `apiToken` is set. |
| `apiToken` | `string` | `""` | Bearer token generated via **Administration → API → Tokens** (validated with Zabbix 7.2). When present the helper skips `user.login` and authenticates every request (including PNG downloads) via `Authorization: Bearer`. |
| `dashboardId` | `number` | `null` | Numeric ID of the dashboard that contains the widget you want to mirror. Required. |
| `widgetId` | `number\|string` | `null` | Optional widget identifier inside the dashboard. When present, the helper resolves that widget and reuses its configured graph. |
| `widgetName` | `string` | `null` | Optional widget title filter used when `widgetId` is not set. The first graph widget whose title matches this string is used. |
| `width` | `number` | `600` | Width in pixels used when requesting the PNG via `chart2.php` (falls back to the widget dimensions when available). |
| `height` | `number` | `300` | Height in pixels used for the PNG request (falls back to the widget dimensions when available). |
| `refreshMinutes` | `number` | `5` | Interval, in minutes, between refreshes. Each refresh reuses the cached auth token and requests a new PNG. Use `refreshInterval` (milliseconds) for backwards compatibility. |
| `requestTimeoutMs` | `number` | `10000` | Milliseconds before JSON-RPC and PNG requests are aborted. When exceeded the helper surfaces a readable error, clears the cached session token, and the module retries on the next scheduled refresh. |

### Mirroring dashboard widgets

The module only works with dashboard widgets maintained in the Zabbix UI. Copy the dashboard and widget identifiers from your browser URL (e.g., `dashboardid=123` and `widgetid=456`) or ask the API for the details:

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

The response shows every widget. For graph widgets, the `fields` array lists the `graphid` and any time overrides stored by the dashboard, while `width`/`height` capture the layout sizing. Provide `dashboardId` plus either `widgetId` or `widgetName` so MagicMirror renders the exact widget you curate in Zabbix.

### Authentication & Error Handling

- With an API token (validated on Zabbix 7.2 and available in earlier releases) in `config.apiToken`, the helper sends it via both `Authorization: Bearer <token>` and `X-Auth-Token` headers for every JSON-RPC call as well as the `chart2.php` PNG download.
- Without `apiToken` the helper falls back to `user.login` using the configured `username`/`password`. The returned session token is cached per `zabbixUrl`/`username` and cleared automatically when Zabbix asks for a new login.
- API responses are validated for HTTP and JSON-RPC errors. Any issue is sent back to the front-end where it is rendered as an error message instead of an image.
- Every request (JSON-RPC and PNG downloads) inherits the configurable `requestTimeoutMs`. When Zabbix fails to respond in time the helper aborts both calls, clears any cached session token, and surfaces a friendly error so the UI can retry on the next refresh.
- Image downloads happen through the Zabbix frontend (`chart2.php`). The helper either sets the `auth=<session>` query parameter (password flow) or reuses the bearer headers described above (token flow).

### Debugging Tips

- Run MagicMirror with `npm start dev` to see console output. Any API errors logged by the helper will show up there.
- Ensure the user has permission to view the chosen dashboard and widget. A `Dashboard … was not found` error usually indicates missing rights or a typo in the ID.

## How it Works

1. `MMM-ZabbixGraphs.js` schedules periodic refreshes and requests data from the helper.
2. `node_helper.js` authenticates through the JSON-RPC API.
3. `dashboard.get` resolves the configured widget, `graph.get`/`graphitem.get` surface metadata, and the PNG is downloaded via `chart2.php`.
4. The helper base64-encodes the image before sending it back to the browser for display.

## Development & Testing

You can verify the helper and front-end logic without launching a full MagicMirror² instance. The module ships with Jest tests that exercise the authentication flow, dashboard widget resolution, and the PNG download safeguards.

```bash
cd modules/MMM-ZabbixGraphs
npm install
npm test
```

Running the suite prints the mocked Zabbix interactions and proves the helper can recover from expired sessions or widget misconfigurations. When you are ready to validate the visual output, start MagicMirror in dev mode (`npm start dev` inside your MagicMirror checkout) and watch the console for the same log messages described in the sections above.
