/* global Module */

Module.register("MMM-ZabbixGraphs", {
  defaults: {
    zabbixUrl: "http://localhost/zabbix",
    username: "",
    password: "",
    graphId: null,
    width: 600,
    height: 300,
    refreshMinutes: 5
  },

  start() {
    this.graphData = null;
    this.error = null;
    this.loaded = false;
    this.scheduleUpdate(0);
  },

  getStyles() {
    return ["MMM-ZabbixGraphs.css"];
  },

  getRefreshIntervalMs() {
    if (typeof this.config.refreshInterval === "number") {
      return Math.max(1000, this.config.refreshInterval);
    }

    const minutes = typeof this.config.refreshMinutes === "number" ? this.config.refreshMinutes : 5;
    return Math.max(1, minutes) * 60 * 1000;
  },

  scheduleUpdate(delay) {
    const nextLoad = typeof delay === "number" ? delay : this.getRefreshIntervalMs();
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      this.sendSocketNotification("GET_GRAPH", this.config);
    }, nextLoad);
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "GRAPH_RESULT") {
      if (payload.error) {
        this.error = payload.error;
        this.graphData = null;
      } else {
        this.graphData = payload;
        this.error = null;
      }
      this.loaded = true;
      this.updateDom();
      this.scheduleUpdate(this.getRefreshIntervalMs());
    }
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.classList.add("mmm-zabbixgraphs");

    if (!this.loaded) {
      wrapper.innerHTML = this.translate("LOADING");
      return wrapper;
    }

    if (this.error) {
      wrapper.innerHTML = `Error: ${this.error}`;
      wrapper.classList.add("small", "dimmed");
      return wrapper;
    }

    if (this.graphData && this.graphData.image) {
      const title = document.createElement("div");
      title.classList.add("bright", "small", "thin", "zabbix-graph-title");
      title.innerHTML = this.graphData.title || "Zabbix Graph";
      wrapper.appendChild(title);

      const img = document.createElement("img");
      img.classList.add("zabbix-graph-image");
      img.src = `data:image/png;base64,${this.graphData.image}`;
      img.width = this.config.width;
      img.height = this.config.height;
      wrapper.appendChild(img);
    }

    return wrapper;
  }
});
