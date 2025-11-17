/** @jest-environment jsdom */

let moduleDefinition;

beforeAll(() => {
  global.Module = {
    register: jest.fn((name, definition) => {
      moduleDefinition = definition;
    })
  };

  jest.isolateModules(() => {
    require("./MMM-ZabbixGraphs.js");
  });
});

function createInstance(overrides = {}) {
  const instance = Object.create(moduleDefinition);
  return Object.assign(
    instance,
    {
      config: { width: 600, height: 300 },
      translate: (value) => value,
      loaded: true,
      graphData: null,
      error: null
    },
    overrides
  );
}

test("graph title is rendered as literal text", () => {
  const maliciousTitle = "<img src=x onerror=alert(1)>";
  const instance = createInstance({
    graphData: { image: "ZmFrZQ==", title: maliciousTitle }
  });

  const dom = moduleDefinition.getDom.call(instance);
  const titleNode = dom.querySelector(".zabbix-graph-title");

  expect(titleNode).not.toBeNull();
  expect(titleNode.textContent).toBe(maliciousTitle);
  expect(titleNode.querySelector("img")).toBeNull();
});

test("error messages are rendered as plain text", () => {
  const maliciousError = "<script>alert(1)</script>";
  const instance = createInstance({
    error: maliciousError
  });

  const dom = moduleDefinition.getDom.call(instance);

  expect(dom.textContent).toContain(`Error: ${maliciousError}`);
  expect(dom.querySelector("script")).toBeNull();
  expect(dom.classList.contains("small")).toBe(true);
  expect(dom.classList.contains("dimmed")).toBe(true);
});
