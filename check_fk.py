import json, sqlite3
conn = sqlite3.connect("database.sqlite")
res = conn.execute("SELECT id FROM nodes").fetchall()
db_nodes = {r[0] for r in res}
with open("src/data/toyama_data.json") as f:
    data = json.load(f)
for n in data.get("nodes", []):
    db_nodes.add(n["id"])
for e in data.get("edges", []):
    if e["source_id"] not in db_nodes: print("Missing source:", e["source_id"])
    if e["target_id"] not in db_nodes: print("Missing target:", e["target_id"])
