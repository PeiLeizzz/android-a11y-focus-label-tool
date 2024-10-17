import torch
import torch.nn as nn
import torchvision
import torchvision.transforms.functional as F
from torchvision import transforms

weight_path = "./image_classifier_focus.pth"
class_num = 2
model = torchvision.models.resnet50()
model.fc = nn.Linear(model.fc.in_features, class_num)
if torch.cuda.is_available():
    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    model.load_state_dict(torch.load(weight_path, map_location=device))
else:
    device = torch.device("cpu")
    model.load_state_dict(torch.load(weight_path, map_location=torch.device("cpu")))
model = model.to(device)


def pred_model(image, coordinator=None):
    """
    传入图片路径,模型预测,正样本返回True,负样本返回False
    coordinator: (left, right, top, bottom)
    """
    transform_array = [
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ]
    if coordinator:
        left, right, top, bottom = coordinator
        transform_array.insert(
            0,
            transforms.Lambda(
                lambda img: F.crop(img, top, left, bottom - top, right - left)
            ),
        )

    # 打开图像并进行预处理
    transform = transforms.Compose(transform_array)
    image_tensor = transform(image).unsqueeze(0)
    image_tensor = image_tensor.to(device)

    # 进行预测
    with torch.no_grad():
        outputs = model(image_tensor)
        _, predicted = torch.max(outputs.data.abs(), 1)
        delt = outputs.data.abs()[0][1] - outputs.data.abs()[0][0]
        return not (delt < -0.0173 and delt > -0.018)
