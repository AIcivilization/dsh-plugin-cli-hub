import { createRequire } from "module";
const req = createRequire(import.meta.url);
const modPath = req.resolve("dsh-plugin-cli-hub");
console.log("resolved:", modPath);
const pkg = req(modPath + "/../../package.json");
console.log("pkg:", pkg.name, pkg.version);
const plugin = await import(modPath);
console.log("keys:", Object.keys(plugin).slice(0, 12));
console.log("default.inject:", plugin.default?.inject);
console.log("export.inject:", plugin.inject);
console.log("name export:", plugin.name);
console.log("default.displayName:", plugin.default?.displayName);

// minimal boot mock
const store = {};
const ctx = {
  reflect: {
    get(name, opt) {
      if (name === "set") return (k, v) => { store[k] = v; };
      if (name === "logger") return () => console;
      if (name === "on") return () => {};
      return undefined;
    },
    provide(n, v, cb) { return v; },
  },
};
try {
  await plugin.default(ctx, {});
  console.log("apply ok; cliHub via store =", typeof store.cliHub);
  console.log("cliHub shape:",
    !!store.cliHub?.scan,
    !!store.cliHub?.registry,
    !!store.cliHub?.quota,
    !!store.cliHub?.tools,
    !!store.cliHub?.agents,
    !!store.cliHub?.ui,
  );
} catch (e) {
  console.error("apply FAIL:", e?.stack ?? e);
}
