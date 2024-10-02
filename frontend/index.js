const searchParams = new URLSearchParams(window.location.search);
const page_id = parseInt(searchParams.get("page_id"));
const backend_url = "http://10.130.128.31:15000";

const { createApp, ref, watch, reactive } = Vue;
const lineWidth = 4;
const body = document.querySelector("body");
const batch = 'batch0'

const app = createApp({
    setup() {
        (getNodeType = (data) => {
            if (!data.valid) {
                return "invalid-node";
            }

            if (data.focusable_label) {
                return "focusable-node";
            }
            return "unfocusable-node";
        }),
            (defaultProps = {
                children: "children",
                label: "label",
                class: getNodeType,
            }),
            (totalCnt = ref(0)),
            (validCnt = ref(0)),
            (treeData = ref([])),
            (treeRef = ref(null)),
            (labelledPageIds = reactive(new Map())),
            (labelledCoordinators = new Map()),
            (handleNodeClick = (data, node) => {
                if (!data.valid) {
                    return;
                }

                let [left, right, top, bottom] = data.coordinator;
                let coordinator = {
                    x: left * canvas.xratio,
                    y: top * canvas.yratio,
                    width: (right - left) * canvas.xratio,
                    height: (bottom - top) * canvas.yratio,
                };

                let key = JSON.stringify(coordinator);
                if (data.focusable_label) {
                    labelledPageIds.delete(data.id);
                    labelledCoordinators.set(
                        key,
                        labelledCoordinators.get(key) - 1
                    );
                    if (labelledCoordinators.get(key) === 0) {
                        labelledCoordinators.delete(key);
                    }
                } else {
                    labelledPageIds.set(data.id, coordinator);
                    if (!labelledCoordinators.has(key)) {
                        labelledCoordinators.set(key, 1);
                    } else {
                        labelledCoordinators.set(
                            key,
                            labelledCoordinators.get(key) + 1
                        );
                    }
                }
                data.focusable_label = !data.focusable_label;
            }),
            (handleMouseEnter = (data) => {
                if (!data.valid) {
                    return;
                }
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                let [left, right, top, bottom] = data.coordinator;
                let coordinator = {
                    x: left * canvas.xratio,
                    y: top * canvas.yratio,
                    width: (right - left) * canvas.xratio,
                    height: (bottom - top) * canvas.yratio,
                };
                let key = JSON.stringify(coordinator);

                // 先画当前的框
                // 优先级：red > purple > green
                ctx.beginPath();
                ctx.lineWidth = lineWidth;
                if (labelledPageIds.has(data.id)) {
                    ctx.strokeStyle = "red";
                } else if (labelledCoordinators.has(key)) {
                    ctx.strokeStyle = "purple";
                } else {
                    ctx.strokeStyle = "green";
                }
                ctx.rect(
                    coordinator.x,
                    coordinator.y,
                    coordinator.width,
                    coordinator.height
                );
                ctx.stroke();

                // 再画其他框
                ctx.beginPath();
                ctx.lineWidth = lineWidth;
                ctx.strokeStyle = "green";
                for (let [page_id, coord] of labelledPageIds.entries()) {
                    if (data.id === page_id || JSON.stringify(coord) === key) {
                        continue;
                    }
                    ctx.rect(coord.x, coord.y, coord.width, coord.height);
                }
                ctx.stroke();
            }),
            (handleMouseLeave = (data) => {
                if (!data.valid) {
                    return;
                }

                ctx.clearRect(0, 0, canvas.width, canvas.height);

                ctx.beginPath();
                ctx.lineWidth = lineWidth;
                ctx.strokeStyle = "green";
                for (let [page_id, coordinator] of labelledPageIds.entries()) {
                    ctx.rect(
                        coordinator.x,
                        coordinator.y,
                        coordinator.width,
                        coordinator.height
                    );
                }
                ctx.stroke();
            }),
            (viewTreeHeight = ref("0px")),
            (checkedTypes = new Set([0, 1])),
            (filterNode = (checkedTypes, data) => {
                if (!data.valid) {
                    return checkedTypes.has(-1);
                }
                if (!data.focusable_label) {
                    return checkedTypes.has(0);
                }
                return checkedTypes.has(1);
            }),
            (searchResult = ref(''));
        return {
            defaultProps,
            treeData,
            treeRef,
            totalCnt,
            validCnt,
            labelledPageIds,
            labelledCoordinators,
            handleNodeClick,
            handleMouseEnter,
            handleMouseLeave,
            viewTreeHeight,
            checkedTypes,
            filterNode,
            searchResult,
        };
    },
});

app.use(ElementPlus);
const vm = app.mount("#app");
const image = document.getElementById("page-image");
const canvas = document.getElementById("page-canvas");
const ctx = canvas.getContext("2d");
const phone_height = page_id >= 0 ? 1600 : 2560, phone_width = page_id >= 0 ? 720 : 1440, extra_bottom = page_id >= 0 ? 78 : 168;

image.src = page_id >= 0 ? `${backend_url}/static/${batch}/${page_id}.png` : `${backend_url}/static/${batch}/${page_id}.jpg`;
image.onload = function () {
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.xratio = canvas.width / phone_width;
    canvas.yratio = canvas.height / phone_height;
};

function isEmpty(obj) {
    for (let key in obj) {
        // 如果进到循环里面，说明有属性。
        return false;
    }
    return true;
}

function json2node(node) {
    let [left, right, top, bottom] = [
        node.screen_left,
        node.screen_right,
        node.screen_top,
        node.screen_bottom,
    ];
    bottom = Math.min(bottom, phone_height - extra_bottom);
    let valid =
        left >= 0 &&
        right >= 0 &&
        top >= 0 &&
        bottom >= 0 &&
        top < phone_height - extra_bottom &&
        right <= phone_width &&
        left < right &&
        top < bottom;
    vm.totalCnt++;
    if (valid) {
        vm.validCnt++;
    }

    let resNode = {
        id: node.id,
        class: node.class_name,
        text: node.text,
        content_description: node.content_description,
        coordinator: [left, right, top, bottom],
        valid: valid,
        clickable: node.clickable,
        focusable: node.focusable,
        long_clickable: node.long_clickable,
        package_name: node.package_name,
        father: node.father,
        children: [],
        focusable_label: node.focusable_label ? node.focusable_label : false,
    };
    if (!node.text || isEmpty(node.text)) {
        resNode.text = "";
    }
    if (!node.content_description || isEmpty(node.content_description)) {
        resNode.content_description = "";
    }
    resNode.label = `${resNode.class} id=${resNode.id} coordinator=[${resNode.coordinator}] ${resNode.clickable ? '<mark>clickable='+resNode.clickable+'</mark>' : 'clickable='+resNode.clickable} ${resNode.focusable ? '<mark>focusable='+resNode.focusable+'</mark>' : 'focusable='+resNode.focusable} ${resNode.long_clickable ? '<mark>long_clickable='+resNode.long_clickable+'</mark>' : 'long_clickable='+resNode.long_clickable} ${!isEmptyStr(resNode.text) ? '<mark>text='+resNode.text+'</mark>' : 'text='+resNode.text} ${!isEmptyStr(resNode.content_description) ? '<mark>content_description='+resNode.content_description+'</mark>' : 'content_description='+resNode.content_description} package_name="${resNode.package_name}"`;
    return resNode;
}

function json2tree(nodes) {
    let root = json2node(nodes[0]);
    nodes[0] = root;
    for (let i = 1; i < nodes.length; i++) {
        let node = json2node(nodes[i]);
        let father = nodes[node.father];
        father.children.push(node);
        nodes[i] = node;
    }
    return [root];
}

function reloadCode(page_id) {
    let imageHeight = document.getElementById("page-image").clientHeight;
    vm.viewTreeHeight = imageHeight;

    const origin_json_url = `${backend_url}/static/${batch}/${page_id}.json`;
    fetch(origin_json_url)
        .then((response) => response.json())
        .then((origin_data) => {
            const labelled_json_url = `${backend_url}/static/${batch}/labelled/${page_id}.json`;
            fetch(labelled_json_url)
                .then((response) => {
                    if (response.status === 404) {
                        return [];
                    }
                    return response.json();
                })
                .then((labelled_data) => {
                    let labelled_page_ids = new Set(labelled_data);
                    let nodes = origin_data["nodes"];
                    for (let node of nodes) {
                        if (!labelled_page_ids.has(node.id)) {
                            continue;
                        }
                        node.focusable_label = true;

                        let [left, right, top, bottom] = [
                            node.screen_left,
                            node.screen_right,
                            node.screen_top,
                            node.screen_bottom,
                        ];
                        bottom = Math.min(bottom, phone_height - extra_bottom);
                        let coordinator = {
                            x: left * canvas.xratio,
                            y: top * canvas.yratio,
                            width: (right - left) * canvas.xratio,
                            height: (bottom - top) * canvas.yratio,
                        };
                        let key = JSON.stringify(coordinator);
                        vm.labelledPageIds.set(node.id, coordinator);
                        if (vm.labelledCoordinators.has(key)) {
                            vm.labelledCoordinators.set(
                                key,
                                vm.labelledCoordinators.get(key) + 1
                            );
                        } else {
                            vm.labelledCoordinators.set(key, 1);
                        }
                    }
                    return nodes;
                })
                .then((nodes) => {
                    vm.treeData = json2tree(nodes);
                })
                .then(() => {
                    vm.$refs.treeRef.filter(vm.checkedTypes);
                })
                .then(() => {
                    drawAllLabel();
                })
                .catch((error) => {
                    console.log(error);
                });
        })
        .catch((error) => console.error("Error:", error));
}

function drawAllLabel() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let [page_id, coordinator] of vm.labelledPageIds.entries()) {
        ctx.beginPath();
        ctx.strokeStyle = "green";
        ctx.lineWidth = lineWidth;
        ctx.rect(
            coordinator.x,
            coordinator.y,
            coordinator.width,
            coordinator.height
        );
        ctx.stroke();
    }
}

function exportCheck() {
    // TODO: 导出
}

layui.use(() => {
    let form = layui.form;
    form.on("checkbox(checkbox-filter)", (data) => {
        let elem = data.elem;
        let checkType = parseInt(elem.value, 10);
        if (elem.checked) {
            vm.checkedTypes.add(checkType);
        } else {
            vm.checkedTypes.delete(checkType);
        }
        vm.$refs.treeRef.filter(vm.checkedTypes);
    });
});

layui.use("table", function () {
    let table = layui.table;
    // 创建渲染实例
    table.render({
        elem: "#table-page",
        url: `${backend_url}/get/list`, // 此处为静态模拟数据，实际使用时需换成真实接口
        page: {
            layout: ["count", "prev", "page", "next", "skip", "refresh"], //自定义分页布局
            groups: 5, //只显示 1 个连续页码
            limit: 10,
            jump: function (obj, first) {
                if (!first) {
                    const url = `${backend_url}/get/list`;
                    fetch(url, {
                        method: "GET",
                        mode: "cors",
                    })
                        .then((data) => data.json())
                        .then((data) => {
                            obj.count = data.count;
                            page_ids = data.page_ids;
                        })
                        .catch((error) => console.error("Error:", error));
                }
            },
        },
        cols: [
            [
                {
                    field: "page_id",
                    title: "页面 ID",
                    sort: true,
                    align: "center",
                },
                {
                    field: "page_label",
                    title: "标注状态",
                    align: "center",
                    templet: function (d) {
                        if (d.page_label === "未标注") {
                            return `<b style="color: blue;">未标注</b>`;
                        } else {
                            return `<b style="color: green;">已标注</b>`;
                        }
                    },
                },
                {
                    field: "total_num",
                    title: "总结点数",
                    align: "center",
                },
                {
                    field: "valid_num",
                    title: "合法结点数",
                    align: "center",
                },
                {
                    field: "labelled_num",
                    title: "已标注结点数",
                    align: "center",
                },
                {
                    field: "operation",
                    title: "操作",
                    align: "center",
                    templet: function (d) {
                        if (d.page_label === "未标注") {
                            return `<button type="button" id="label-button" class="layui-btn layui-bg-blue" onclick="gotoLabel(${d.page_id})">标注</button>`;
                        } else {
                            return `<button type="button" id="check-button" class="layui-btn" onclick="gotoCheck(${d.page_id})">检查</button>`;
                        }
                    },
                    minWidth: 100,
                },
            ],
        ],
        parseData: function (res) {
            let data = [];
            let page_ids = res.page_ids;
            let page_labels = res.page_labels;
            let total_nums = res.total_nums;
            let valid_nums = res.valid_nums;
            let labelled_nums = res.labelled_nums;

            for (let i = 0; i < page_ids.length; i++) {
                data.push({
                    page_id: page_ids[i],
                    page_label: page_labels[i] == 0 ? "未标注" : "已标注",
                    total_num: total_nums[i],
                    valid_num: valid_nums[i],
                    labelled_num: labelled_nums[i]
                });
            }
            return {
                code: res.code, // 解析接口状态
                msg: res.msg, // 解析提示文本
                count: res.count, // 解析数据长度
                data: data, // 解析数据列表
            };
        },
    });

    let form = layui.form;
    form.on("radio()", function (data) {
        let filter = data.value;
        table.reload("table-page", {
            page: {
                curr: 1,
                layout: ["count", "prev", "page", "next", "skip", "refresh"], //自定义分页布局
                groups: 5, //只显示 1 个连续页码
                limit: 10,
            },
            where: {
                filter: filter,
            },
        });
    });
});

function submitLabel() {
    const url = `${backend_url}/post/label`;
    fetch(url, {
        method: "POST",
        mode: "cors",
        body: JSON.stringify({
            page_id: page_id,
            label: [...vm.labelledPageIds.keys()],
        }),
        headers: {
            "content-type": "application/json",
        },
    })
        .then(() => {
            let table = layui.table;
            table.reloadData("table-page");
        })
        .then(() => {
            let layer = layui.layer;
            layer.msg("提交成功", { icon: 1, time: 2000 });
        })
        .catch((error) => {
            let layer = layui.layer;
            layer.msg(`提交失败：${error}`, { icon: 2, time: 2000 });
        });
}

function gotoLabel(page_id) {
    let cur = window.location.href.split("?")[0];
    window.open(`${cur}?page_id=${page_id}`);
}

function gotoCheck(page_id) {
    let cur = window.location.href.split("?")[0];
    window.open(`${cur}?page_id=${page_id}`);
}

function resetLabel() {
    let layer = layui.layer;
    layer.confirm(
        "重置后当前所有标注都将被清空，是否确定？",
        {
            title: '提示',
            icon: 3,
            btn: ["确定", "关闭"],
        },
        function () {
            doReset();
            layer.msg("已重置", { icon: 1 });
        },
        function () {}
    );
}

function doReset() {
    dfsResetNodeLabel(vm.treeData[0]);
    vm.labelledPageIds.clear();
    vm.labelledCoordinators.clear();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function dfsResetNodeLabel(node) {
    if (!node) {
        return;
    }
    node.focusable_label = false;
    for (let child of node.children) {
        dfsResetNodeLabel(child);
    }
}

function preLabelByRule() {
    let layer = layui.layer;
    layer.confirm(
        "预标前会将当前所有标注清空，是否确定？",
        {
            title: '提示',
            icon: 3,
            btn: ["确定", "关闭"],
        },
        function () {
            doReset();
            dfsPreLabelNode(vm.treeData[0]);
            drawBoxes();
            layer.msg("预标完成", { icon: 1 });
        },
        function () {}
    );
}

function dfsPreLabelNode(node, preLabelSet=null) {
    if (!node) {
        return;
    }
    if (preLabelSet != null) {
        node.focusable_label = preLabelSet.has(node.id)
    } else {
        node.focusable_label =
            node.valid &&
            (node.focusable ||
                node.clickable ||
                !isEmptyStr(node.text) ||
                !isEmptyStr(node.content_description));
    }

    if (node.focusable_label) {
        let [left, right, top, bottom] = node.coordinator;
        let coordinator = {
            x: left * canvas.xratio,
            y: top * canvas.yratio,
            width: (right - left) * canvas.xratio,
            height: (bottom - top) * canvas.yratio,
        };

        let key = JSON.stringify(coordinator);
        labelledPageIds.set(node.id, coordinator);
        if (!labelledCoordinators.has(key)) {
            labelledCoordinators.set(key, 1);
        } else {
            labelledCoordinators.set(
                key,
                labelledCoordinators.get(key) + 1
            );
        }
    }
    for (let child of node.children) {
        dfsPreLabelNode(child, preLabelSet);
    }
}

function drawBoxes() {
    ctx.beginPath();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = "green";
    for (let [page_id, coordinator] of vm.labelledPageIds.entries()) {
        ctx.rect(
            coordinator.x,
            coordinator.y,
            coordinator.width,
            coordinator.height
        );
    }
    ctx.stroke();
}

function preLabelByAlgo() {
    let layer = layui.layer;
    layer.confirm(
        "预标前会将当前所有标注清空，是否确定？",
        {
            title: '提示',
            icon: 3,
            btn: ["确定", "关闭"],
        },
        function () {
            let load_index = layer.load(0, {shade: false});
            const url = `${backend_url}/get/prelabel/algo?page_id=${page_id}`
            fetch(url, {
                method: "GET",
                mode: "cors",
            })
            .then((data) => data.json())
            .then((data) => {
                return data.labels;
            })
            .then((labels) => {
                doReset();
                dfsPreLabelNode(vm.treeData[0], new Set(labels));
                drawBoxes();
                layer.close(load_index); 
                layer.msg("预标完成", { icon: 1 });
            })
            .catch((error) => console.error("Error:", error));
        },
        function () {}
    );
}

function preLabelByRuleTip() {
    let layer = layui.layer;
    layer.tips(
        "标注 focusable 为 True / clickable 为 True / 含有 text 属性 / 含有 content-description 属性的结点",
        "#pre-label-by-rule-button",
        { tips: [1, "black"], time: 3000 }
    );
}

function preLabelByAlgoTip() {
    let layer = layui.layer;
    layer.tips("通过分类算法过滤 focusable 为 True / clickable 为 True / 含有 text 属性 / 含有 content-description 属性的结点", "#pre-label-by-algo-button", {
        tips: [1, "black"],
        time: 3000,
    });
}

function isEmptyStr(s) {
	if (s == undefined || s == null || s == '') {
		return true
	}
	return false
}

function checkMouseCoordinator(offsetX, offsetY) {
    let target_page_ids = new Set();
    for (let [page_id, coordinator] of vm.labelledPageIds.entries()) {
        let left = coordinator.x, top = coordinator.y;
        let right = left + coordinator.width, bottom = top + coordinator.height;
        // 四条边框
        if (left - lineWidth / 2 <= offsetX && right + lineWidth / 2 >= offsetX &&
            top - lineWidth / 2 <= offsetY && top + lineWidth / 2 >= offsetY
        ) {
            target_page_ids.add(page_id);
            continue;
        }
        if (
            left - lineWidth / 2 <= offsetX && right + lineWidth / 2 >= offsetX &&
            bottom - lineWidth / 2 <= offsetY && bottom + lineWidth / 2 >= offsetY
        ) {
            target_page_ids.add(page_id);
            continue;
        }
        if (left - lineWidth / 2 <= offsetX && left + lineWidth / 2 >= offsetX &&
            top - lineWidth / 2 <= offsetY && bottom + lineWidth / 2 >= offsetY
        ) {
            target_page_ids.add(page_id);
            continue;
        }
        if (
            right - lineWidth / 2 <= offsetX && right + lineWidth / 2 >= offsetX &&
            top - lineWidth / 2 <= offsetY && bottom + lineWidth / 2 >= offsetY
        ) {
            target_page_ids.add(page_id);
            continue;
        }
    }
    return target_page_ids;
}

canvas.addEventListener("mousemove", (e) => {
    let offsetX = e.offsetX, offsetY = e.offsetY;
    let target_page_ids = checkMouseCoordinator(offsetX, offsetY);

    dfsHighlightLabel(vm.treeData[0], target_page_ids);
    if (target_page_ids.size > 0 || body.style.cursor === "pointer") {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let [page_id, coordinator] of vm.labelledPageIds.entries()) {
            ctx.beginPath();
            ctx.lineWidth = lineWidth;
            ctx.strokeStyle = target_page_ids.has(page_id) ? "red" : "green";
            ctx.rect(
                coordinator.x,
                coordinator.y,
                coordinator.width,
                coordinator.height
            );
            ctx.stroke();
        }
    }

    if (target_page_ids.size > 0) {
        body.style.cursor = "pointer";
    } else {
        body.style.cursor = "default";
    }
})

canvas.addEventListener("mouseleave", (e) => {
    body.style.cursor = "default";
    dfsHighlightLabel(vm.treeData[0], new Set());

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBoxes();
})

canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) { 
        if (body.style.cursor !== "pointer") {
            return;
        }

        let offsetX = e.offsetX, offsetY = e.offsetY;
        let target_page_ids = checkMouseCoordinator(offsetX, offsetY);

        body.style.cursor = "default";
        dfsClickBox(vm.treeData[0], target_page_ids);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawBoxes();
    } else if (e.button === 2) {
        let offsetX = e.offsetX, offsetY = e.offsetY;
        let target_node_ids = checkMouseInNode(offsetX, offsetY);
        vm.searchResult = target_node_ids.join(', ');
    }
})

function dfsHighlightLabel(node, target_page_ids) {
    if (!node) {
        return;
    }
    let prefix = '<b style="color: red; font-size: 20px;">';
    let suffix = '</b>';
    if (target_page_ids.has(node.id)) {
        if (!node.label.includes(prefix)) {
            node.label = `${prefix}${node.label}${suffix}`;
        }
    } else {
        if (node.label.includes(prefix)) {
            node.label = node.label.slice(prefix.length).slice(0, -suffix.length - 1);
        }
    }
    for (let child of node.children) {
        dfsHighlightLabel(child, target_page_ids);
    }
}

function dfsClickBox(node, target_page_ids) {
    if (!node) {
        return;
    }
    let prefix = '<b style="color: red; font-size: 20px;">';
    let suffix = '</b>';
    if (target_page_ids.has(node.id)) {
        node.focusable_label = false;
        if (node.label.includes(prefix)) {
            node.label = node.label.slice(prefix.length).slice(0, -suffix.length - 1);
        }

        let [left, right, top, bottom] = node.coordinator;
        let coordinator = {
            x: left * canvas.xratio,
            y: top * canvas.yratio,
            width: (right - left) * canvas.xratio,
            height: (bottom - top) * canvas.yratio,
        };

        let key = JSON.stringify(coordinator);
        vm.labelledPageIds.delete(node.id);
        vm.labelledCoordinators.set(
            key,
            vm.labelledCoordinators.get(key) - 1
        );
        if (vm.labelledCoordinators.get(key) === 0) {
            vm.labelledCoordinators.delete(key);
        }
    }
    for (let child of node.children) {
        dfsClickBox(child, target_page_ids);
    }
}

function checkMouseInNode(offsetX, offsetY) {
    target_node_ids = []
    dfsMouseInNode(vm.treeData[0], target_node_ids, offsetX, offsetY);
    return target_node_ids;
}

function dfsMouseInNode(node, node_ids, x, y) {
    if (!node) {
        return;
    }
    let [left, right, top, bottom] = node.coordinator;
    let coordinator = {
        x: left * canvas.xratio,
        y: top * canvas.yratio,
        width: (right - left) * canvas.xratio,
        height: (bottom - top) * canvas.yratio,
    };
    if (coordinator.x <= x && coordinator.y <= y &&
        coordinator.x + coordinator.width >= x && coordinator.y + coordinator.height >= y) {
        node_ids.push(node.id);
    }

    for (let child of node.children) {
        dfsMouseInNode(child, node_ids, x, y);
    }
}


reloadCode(page_id);
