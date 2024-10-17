import numpy as np
import torch
import torch.nn as nn
import torchvision.transforms as transforms
from torchvision import models
from transformers import BertModel, BertTokenizer


class Config:
    def __init__(self):
        self.device = torch.device("cuda:0")
        self.image_dim = 1000
        self.text_dim = 768 * 4

        self.text_mlp_input_dim = self.text_dim
        self.text_mlp_hidden_dims = []
        self.text_mlp_output_dim = 1000
        self.text_mlp_dropout = 0.5

        self.attribute_mlp_input_dim = 11 + 4
        self.attribute_mlp_hidden_dims = [256]
        self.attribute_mlp_output_dim = 1000
        self.attribute_mlp_dropout = 0.5

        self.mlp_input_dim = (
            self.image_dim + self.text_mlp_output_dim + self.attribute_mlp_output_dim
        )
        self.mlp_hidden_dims = [1024, 256, 32]
        self.mlp_output_dim = 2
        self.mlp_dropout = 0.5

        self.checkpoint_file = (
            "../../../model_checkpoint/vision_class_model/mlp_a11y_v1_part_label.pt"
        )


config = Config()


class MLP(nn.Module):
    def __init__(
        self,
        input_dim,
        hidden_dims,
        output_dim,
        dropout,
    ):
        super().__init__()

        self.layers = nn.Sequential()
        if not hidden_dims:
            hidden_dims = []

        hidden_dims.insert(0, input_dim)
        hidden_dims.append(output_dim)
        for i in range(len(hidden_dims) - 1):
            if i < len(hidden_dims) - 2:
                self.layers.extend(
                    nn.Sequential(
                        nn.Linear(hidden_dims[i], hidden_dims[i + 1], bias=False),
                        nn.ReLU(),
                    )
                )
            else:
                if dropout:
                    self.layers.extend(
                        nn.Sequential(
                            nn.Dropout(dropout),
                            nn.Linear(hidden_dims[i], hidden_dims[i + 1], bias=False),
                        )
                    )
                else:
                    self.layers.extend(
                        nn.Sequential(
                            nn.Linear(hidden_dims[i], hidden_dims[i + 1], bias=False)
                        )
                    )

    def forward(self, x):
        return self.layers(x)


class MLPModel(nn.Module):
    def __init__(
        self, image_dim, text_dim, mlp_model, text_mlp_model, attribute_mlp_model
    ):
        super().__init__()
        self.tokenizer = BertTokenizer.from_pretrained("bert-base-uncased")
        self.text_pretrained_model = BertModel.from_pretrained("bert-base-uncased")
        self.vision_pretrained_model = models.resnet18(pretrained=True)
        self.vision_pretrained_model.conv1 = nn.Conv2d(
            4, 64, kernel_size=7, stride=2, padding=3, bias=False
        )

        self.attribute_mlp_model = attribute_mlp_model
        self.text_mlp_model = text_mlp_model
        self.mlp_model = mlp_model

    def forward(self, batch):
        image, texts, attribute = (
            batch["image"],
            batch["text"],
            batch["attribute"],
        )  # texts: [3, N]

        text_embeddings = []
        for text in texts:
            encoded_inputs = self.tokenizer(
                text,
                add_special_tokens=True,
                padding="max_length",
                max_length=512,
                return_tensors="pt",
                truncation=True,
            ).to(config.device)

            with torch.no_grad():
                # [N, H]
                text_embeddings.append(
                    self.text_pretrained_model(**encoded_inputs).last_hidden_state[
                        :, 0, :
                    ]
                )

        with torch.no_grad():
            image_embeddings = self.vision_pretrained_model(image)

        # text_embeddings: [X, N, H] --> [N, X, H] --> [N, X * H]
        text_embeddings = torch.stack(text_embeddings, dim=0).permute(1, 0, 2)
        text_embeddings = text_embeddings.reshape(text_embeddings.shape[0], -1)
        text_embeddings = self.text_mlp_model(text_embeddings)

        attribute_embeddings = self.attribute_mlp_model(attribute)

        total_embeddings = torch.cat(
            (text_embeddings, image_embeddings, attribute_embeddings), dim=-1
        )
        return torch.softmax(self.mlp_model(total_embeddings), dim=1)


text_mlp_model = MLP(
    config.text_mlp_input_dim,
    config.text_mlp_hidden_dims,
    config.text_mlp_output_dim,
    config.text_mlp_dropout,
).to(config.device)
attribute_mlp_model = MLP(
    config.attribute_mlp_input_dim,
    config.attribute_mlp_hidden_dims,
    config.attribute_mlp_output_dim,
    config.attribute_mlp_dropout,
).to(config.device)
mlp_model = MLP(
    config.mlp_input_dim,
    config.mlp_hidden_dims,
    config.mlp_output_dim,
    config.mlp_dropout,
).to(config.device)
model = MLPModel(
    config.image_dim,
    config.text_dim,
    mlp_model,
    text_mlp_model,
    attribute_mlp_model,
).to(config.device)
model.load_state_dict(torch.load(config.checkpoint_file, map_location=config.device))


class ScreenshotMaskTransform:
    def __init__(self, coordinate):
        self.left, self.right, self.top, self.bottom = coordinate

    def __call__(self, image):
        image_shape = image.size[::-1]  # w, h -> h, w
        mask = self.create_mask(image_shape)
        mask = np.expand_dims(mask, axis=2)
        return np.concatenate((image, mask), axis=2)

    def create_mask(self, image_shape):
        mask = np.zeros(image_shape, dtype=np.uint8)
        mask[self.top : self.bottom, self.left : self.right] = 1
        return mask


class RGBNormalizeTransform:
    def __init__(self, mean, std):
        self.mean = mean
        self.std = std

    def __call__(self, tensor):
        # 仅对 RGB 通道进行归一化
        for t, m, s in zip(tensor, self.mean, self.std):
            t[:3].sub_(m).div_(s)
        return tensor


def pred_model(image, nodes):
    images, texts, attributes = [], [[], [], [], []], []
    for node in nodes:
        transform = transforms.Compose(
            [
                ScreenshotMaskTransform(node["algo_coordinator"]),
                transforms.ToTensor(),
                transforms.Resize(256),
                RGBNormalizeTransform([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
            ]
        )

        images.append(transform(image))
        texts[0].append(
            node["class_name"].split(".")[-1].lower()
            if node.get("class_name", None)
            else "none"
        )
        texts[1].append(
            node["view_id_resource_name"].split("/")[-1].lower()
            if node.get("view_id_resource_name", None)
            else "none"
        )
        texts[2].append(
            node["content_description"]
            if node.get("content_description", None)
            else "none"
        )
        texts[3].append(node["text"] if node.get("text", None) else "none")
        attribute = [
            1 if node.get("focusable", None) else 0,
            1 if node.get("checkable", None) else 0,
            1 if node.get("checked", None) else 0,
            1 if node.get("focused", None) else 0,
            1 if node.get("selected", None) else 0,
            1 if node.get("clickable", None) else 0,
            1 if node.get("long_clickable", None) else 0,
            1 if node.get("context_clickable", None) else 0,
            1 if node.get("enabled", None) else 0,
            1 if node.get("text", None) else 0,
            1 if node.get("content_description", None) else 0,
        ]
        attribute += node["normal_algo_cooridnator"]
        attributes.append(torch.tensor(attribute))

    labels, probs = [], {}
    if not nodes:
        return labels, probs

    interval = 256
    for i in range(0, len(nodes), interval):
        batch = {
            "image": torch.stack(images[i : i + interval], dim=0).to(config.device),
            "text": [text[i : i + interval] for text in texts],
            "attribute": torch.stack(attributes[i : i + interval], dim=0).to(
                config.device
            ),
        }
        outputs = model(batch)
        max_p, preds = torch.max(outputs, 1)

        for j, pred in enumerate(preds):
            if pred == 1:
                labels.append(nodes[i + j]["id"])
            probs[nodes[i + j]["id"]] = round(max_p[j].item(), 2)

    return labels, probs
