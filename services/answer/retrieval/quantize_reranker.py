"""Write an int8 (dynamic) copy of the local cross-encoder (build/intelligence, 2026-11-12).

  .venv/bin/python services/answer/retrieval/quantize_reranker.py SRC_SNAPSHOT_DIR OUT_DIR

SRC_SNAPSHOT_DIR is the downloaded jina-reranker-v2-base-multilingual snapshot
(onnx/model.onnx + tokenizer files). Offline; MatMul/Gemm weights only.
"""
import shutil
import sys
from pathlib import Path

from onnxruntime.quantization import QuantType, quantize_dynamic

src, out = Path(sys.argv[1]), Path(sys.argv[2])
(out / 'onnx').mkdir(parents=True, exist_ok=True)
for f in src.glob('*.json'):
    shutil.copyfile(f.resolve(), out / f.name)
quantize_dynamic(str(src / 'onnx' / 'model.onnx'), str(out / 'onnx' / 'model.onnx'), weight_type=QuantType.QInt8, op_types_to_quantize=['MatMul', 'Gemm'])
print(out)
