const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Collection } = require("postman-collection");

const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, name), "utf8"));
const collection = read("Timetable-Admin.postman_collection.json");
const environment = read("Local.postman_environment.json");
const keys = new Set(environment.values.map(v => v.key));
const sdk = new Collection(collection);
let requests = 0;
let scripts = 0;

function visit(items) {
  for (const item of items) {
    if (item.item) { visit(item.item); continue; }
    requests++;
    assert(item.request.method && item.request.url, item.name);
    assert(item.event.some(e => e.listen === "test"), "Assertion wajib: " + item.name);
    for (const event of item.event || []) {
      new vm.Script(event.script.exec.join("\n"), { filename: item.name });
      scripts++;
    }
  }
}
visit(collection.item);
for (const match of JSON.stringify(collection).matchAll(/\{\{([^{}]+)\}\}/g)) {
  assert(match[1].startsWith("$") || keys.has(match[1]), "Variabel belum didefinisikan: " + match[1]);
}
for (const variable of environment.values) {
  if (/Password$|Token$|^ingestKey$/.test(variable.key)) {
    assert.equal(variable.value, "", "Secret contoh harus kosong: " + variable.key);
  }
}
assert.equal(collection.info.schema, "https://schema.getpostman.com/json/collection/v2.1.0/collection.json");
assert.equal(sdk.items.count(), collection.item.length);
assert.equal(requests, 28);
console.log("PASS: " + requests + " requests, " + scripts + " scripts; SDK import, variables, syntax, and blank example secrets.");
console.log("Offline validation only; this command does not test backend responses.");
