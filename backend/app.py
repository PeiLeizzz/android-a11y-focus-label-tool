import glob
import json
import os

import a11y_mlp_classifier
import online_focus_classifier
from flask import Flask, request
from flask_cors import CORS
from PIL import Image

app = Flask(__name__)
static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app.config["STATIC_FOLDER"] = static_dir
CORS(app)

total_page_ids_map = {}
not_labelled_page_ids_map = {}
labelled_page_ids_map = {}
exclude_dirs = set("bad_data")


def load_all_page():
    for d in os.listdir(static_dir):
        if d in exclude_dirs:
            continue

        total_page_ids_map[d] = set()
        not_labelled_page_ids_map[d] = set()
        labelled_page_ids_map[d] = set()

        dataset_dir = os.path.join(static_dir, d)
        for json_file in glob.glob(os.path.join(dataset_dir, "*.json")):
            page_id = int(json_file.split("/")[-1].split(".")[0])

            total_page_ids_map[d].add(page_id)
            if os.path.exists(f"{dataset_dir}/labelled/{page_id}.json"):
                labelled_page_ids_map[d].add(page_id)
            else:
                not_labelled_page_ids_map[d].add(page_id)

        labelled_dir = os.path.join(dataset_dir, "labelled")
        if not os.path.exists(labelled_dir):
            os.mkdir(labelled_dir)


load_all_page()


@app.route("/")
def hello_world():
    return "<p>Hello, World!</p>"


@app.route("/post/label", methods=["POST"])
def save_label():
    body = request.json
    page_id = int(body["page_id"])
    label = body["label"]
    batch = body["batch"]

    if not os.path.exists(f"./static/{batch}"):
        return (
            {"code": 1, "msg": f"no such batch: {batch}"},
            404,
            {"Content-Type": "application/json"},
        )

    with open(f"./static/{batch}/labelled/{page_id}.json", "w", encoding="utf-8") as f:
        json.dump(label, f)

    if page_id in not_labelled_page_ids_map[batch]:
        not_labelled_page_ids_map[batch].remove(page_id)
        labelled_page_ids_map[batch].add(page_id)

    return {"code": 0, "msg": "success"}, 200, {"Content-Type": "application/json"}


@app.route("/get/list", methods=["GET"])
def fetch_list():
    args = request.args
    # -1: all, 0: not labelled, 1: labelled
    filter = int(args.get("filter", -1))
    batch = args.get("batch")

    if not os.path.exists(f"./static/{batch}"):
        return (
            {"code": 1, "msg": f"no such batch: {batch}"},
            404,
            {"Content-Type": "application/json"},
        )

    page_ids = []
    if filter == 0:
        page_ids = list(not_labelled_page_ids_map[batch])
    elif filter == 1:
        page_ids = list(labelled_page_ids_map[batch])
    else:
        page_ids = list(total_page_ids_map[batch])
    page_ids.sort()
    return fetch_list_condition(page_ids, args)


def fetch_list_condition(page_ids, args):
    page_no = int(args.get("page", 1)) - 1
    page_sz = int(args.get("limit", 10))
    batch = args.get("batch")

    if page_sz < 0:
        page_sz = 10

    total_no = int(len(page_ids) / page_sz)
    if len(page_ids) % page_sz > 0:
        total_no += 1

    if total_no - 1 < page_no:
        page_no = total_no - 1

    st = page_no * page_sz
    target_ids = page_ids[st : st + page_sz]
    target_labels, totalNums, validNums, labelledNums = [], [], [], []
    for target_id in target_ids:
        totalNum, validNum = handleNodeNum(target_id, batch)
        totalNums.append(totalNum)
        validNums.append(validNum)

        if target_id in not_labelled_page_ids_map[batch]:
            target_labels.append(0)
            labelledNums.append(0)
        if target_id in labelled_page_ids_map[batch]:
            target_labels.append(1)
            labelledNums.append(handleLabelledNodeNum(target_id, batch))

    data = {
        "code": 0,
        "msg": "success",
        "page_ids": target_ids,
        "page_labels": target_labels,
        "total_nums": totalNums,
        "valid_nums": validNums,
        "labelled_nums": labelledNums,
        "count": len(page_ids),
    }

    response = json.dumps(data)
    return response, 200, {"Content-Type": "application/json"}


def handleNodeNum(page_id, batch):
    extra_bottom = 78 if page_id >= 0 else 168
    phone_height = 1600 if page_id >= 0 else 2560
    phone_width = 720 if page_id >= 0 else 1440

    totalNum = validNum = 0
    with open(f"./static/{batch}/{page_id}.json", "r", encoding="utf-8") as f:
        nodes = json.load(f)["nodes"]
    for node in nodes:
        left, right, top, bottom = (
            node["screen_left"],
            node["screen_right"],
            node["screen_top"],
            node["screen_bottom"],
        )
        bottom = min(bottom, phone_height - extra_bottom)
        right = min(right, phone_width)
        valid = (
            left >= 0
            and right >= 0
            and top >= 0
            and bottom >= 0
            and top < phone_height - extra_bottom
            and left < right
            and top < bottom
        )

        totalNum += 1
        if valid:
            validNum += 1

    return totalNum, validNum


def handleLabelledNodeNum(page_id, batch):
    json_file = f"./static/{batch}/labelled/{page_id}.json"
    if not os.path.exists(json_file):
        return 0
    with open(json_file, "r", encoding="utf-8") as f:
        return len(json.load(f))


@app.route("/get/prelabel/algo", methods=["GET"])
def get_algo_pre_labels():
    args = request.args
    page_id = int(args.get("page_id"))
    batch = args.get("batch")

    if not os.path.exists(f"./static/{batch}"):
        return (
            {"code": 1, "msg": f"no such batch: {batch}"},
            404,
            {"Content-Type": "application/json"},
        )

    dataset_dir = f"./static/{batch}"
    image_file = (
        f"{dataset_dir}/{page_id}.png"
        if page_id >= 0
        else f"{dataset_dir}/{page_id}.jpg"
    )
    json_file = f"{dataset_dir}/{page_id}.json"

    if not os.path.exists(image_file) or not os.path.exists(json_file):
        return (
            {"code": 1, "msg": "no such page"},
            404,
            {"Content-Type": "application/json"},
        )
    extra_bottom = 78 if page_id >= 0 else 168
    phone_height = 1600 if page_id >= 0 else 2560
    phone_width = 720 if page_id >= 0 else 1440

    page_image = Image.open(image_file)
    # png 4 通道，转成 rgb
    if ".png" in image_file:
        page_image = page_image.convert("RGB")
    w, h = page_image.size
    x_ratio = w / phone_width
    y_ratio = h / phone_height
    with open(json_file, "r", encoding="utf-8") as f:
        nodes = json.load(f)["nodes"]

    labels = []
    for node in nodes:
        left, right, top, bottom = (
            node["screen_left"],
            node["screen_right"],
            node["screen_top"],
            node["screen_bottom"],
        )
        bottom = min(bottom, phone_height - extra_bottom)
        right = min(right, phone_width)
        valid = (
            left >= 0
            and right >= 0
            and top >= 0
            and bottom >= 0
            and top < phone_height - extra_bottom
            and left < right
            and top < bottom
        )
        if not valid:
            continue

        if (
            not node["clickable"]
            and not node["focusable"]
            and not node["text"]
            and not node["content_description"]
        ):
            continue

        if online_focus_classifier.pred_model(
            page_image,
            coordinator=(
                int(left * x_ratio),
                int(right * x_ratio),
                int(top * y_ratio),
                int(bottom * y_ratio),
            ),
        ):
            labels.append(node["id"])

    return (
        {"code": 0, "msg": "success", "labels": labels},
        200,
        {"Content-Type": "application/json"},
    )


@app.route("/get/prelabel/algo/v2", methods=["GET"])
def get_algo_pre_labels_v2():
    args = request.args
    page_id = int(args.get("page_id"))
    batch = args.get("batch")

    if not os.path.exists(f"./static/{batch}"):
        return (
            {"code": 1, "msg": f"no such batch: {batch}"},
            404,
            {"Content-Type": "application/json"},
        )

    dataset_dir = f"./static/{batch}"
    image_file = (
        f"{dataset_dir}/{page_id}.png"
        if page_id >= 0
        else f"{dataset_dir}/{page_id}.jpg"
    )
    json_file = f"{dataset_dir}/{page_id}.json"

    if not os.path.exists(image_file) or not os.path.exists(json_file):
        return (
            {"code": 1, "msg": "no such page"},
            404,
            {"Content-Type": "application/json"},
        )
    extra_bottom = 78 if page_id >= 0 else 168
    phone_height = 1600 if page_id >= 0 else 2560
    phone_width = 720 if page_id >= 0 else 1440

    page_image = Image.open(image_file)
    # png 4 通道，转成 rgb
    if ".png" in image_file:
        page_image = page_image.convert("RGB")
    w, h = page_image.size
    x_ratio = w / phone_width
    y_ratio = h / phone_height
    with open(json_file, "r", encoding="utf-8") as f:
        nodes = json.load(f)["nodes"]

    valid_nodes = []
    labels = []
    for node in nodes:
        left, right, top, bottom = (
            node["screen_left"],
            node["screen_right"],
            node["screen_top"],
            node["screen_bottom"],
        )
        bottom = min(bottom, phone_height - extra_bottom)
        right = min(right, phone_width)
        valid = (
            left >= 0
            and right >= 0
            and top >= 0
            and bottom >= 0
            and top < phone_height - extra_bottom
            and left < right
            and top < bottom
        )
        if not valid:
            continue

        node["algo_coordinator"] = [
            int(left * x_ratio),
            int(right * x_ratio),
            int(top * y_ratio),
            int(bottom * y_ratio),
        ]
        node["normal_algo_cooridnator"] = [
            left / phone_width,
            right / phone_width,
            top / phone_height,
            bottom / phone_height,
        ]
        valid_nodes.append(node)

    labels, probs = a11y_mlp_classifier.pred_model(page_image, valid_nodes)

    return (
        {"code": 0, "msg": "success", "labels": labels, "probs": probs},
        200,
        {"Content-Type": "application/json"},
    )


if __name__ == "__main__":
    app.run(debug=True, port=15000, host="0.0.0.0")
