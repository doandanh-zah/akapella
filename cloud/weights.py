"""Pinned and verified HTDemucs ONNX weights."""

WEIGHTS = {
    4: (
        "https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/d54ed9eb60e258ea82131c6ee14578628816456a/htdemucs_fp16weights.onnx",
        "d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a",
    ),
    6: (
        "https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/49df9b6989cf2150840ea65b0bef77a2e471b678/htdemucs_6s_fp16weights.onnx",
        "7ce55792e2231c93fbf92de95f5fd5b3a5e6c89f7db690dfd693e8f1dce56869",
    ),
}

# Official KUIELab MDX-Net submission B vocal checkpoint.
VOCAL_WEIGHTS = {
    2: (
        "https://media.githubusercontent.com/media/kuielab/mdx-net-submission/18014d705e18f222e53c7d049a0994a27c1c41be/onnx/vocals.onnx",
        "9b7dcb9d878acb0f3e64ff3fd27750faae96577013f6d50f5996875bf4250713",
    ),
}
