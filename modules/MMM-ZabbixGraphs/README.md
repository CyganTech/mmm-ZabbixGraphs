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
    username: "api-user",
    password: "superSecret",
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
| `username` | `string` | `""` | Zabbix username that is allowed to access the graph. |
| `password` | `string` | `""` | Password for the user above. |
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

- The node helper authenticates with `user.login` and caches the token per `zabbixUrl`/`username`. If Zabbix requests a new login (e.g., token expires), the helper automatically clears the cache and logs in again on the next request.
- API responses are validated for HTTP and JSON-RPC errors. Any issue is sent back to the front-end where it is rendered as an error message instead of an image.
- Image downloads happen through the Zabbix frontend (`chart2.php`) using the API token via the `auth` parameter.

### Debugging Tips

- Run MagicMirror with `npm start dev` to see console output. Any API errors logged by the helper will show up there.
- Ensure the user has permission to view the chosen `graphId`. A `Graph was not found` error usually indicates missing rights or a typo in the ID.

## How it Works

1. `MMM-ZabbixGraphs.js` schedules periodic refreshes and requests data from the helper.
2. `node_helper.js` authenticates through the JSON-RPC API.
3. `graph.get` and `graphitem.get` are used to validate access and surface metadata.
4. The PNG is downloaded via `chart2.php` and base64-encoded before being sent back to the browser.

