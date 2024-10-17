import json
import os
import shutil

labelled_page_ids = []
for label_file in os.listdir("./labelled"):
    if not ".json" in label_file or "-" in label_file or "file_map" in label_file:
        continue

    page_id = int(label_file.split(".")[0])
    labelled_page_ids.append(page_id)

labelled_page_ids.sort()

start_index = 1000000
file_map = {}

for page_id in labelled_page_ids:
    with open(f"./{page_id}.json", "r", encoding="utf-8") as f:
        data = json.load(f)

    with open(f"./labelled/{page_id}.json", "r", encoding="utf-8") as f:
        labels = set(json.load(f))

    for node in data["nodes"]:
        if node["id"] in labels:
            node["focusable_manual_label"] = True
        else:
            node["focusable_manual_label"] = False

    with open(
        f"../../../../../my_dataset/a11y/hierarchy/{start_index}.json",
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(data, f)

    shutil.copyfile(
        f"./{page_id}.png",
        f"../../../../../my_dataset/a11y/screenshot/{start_index}.png",
    )

    file_map[page_id] = start_index
    start_index += 1

with open("./labelled/file_map.json", "w", encoding="utf-8") as f:
    json.dump(file_map, f)
