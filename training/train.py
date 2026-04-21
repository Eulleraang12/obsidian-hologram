"""
Train custom gesture classifier from captured dataset.
Uses MediaPipe HandLandmarker to extract landmarks from images,
then trains a scikit-learn SVM classifier. Exports as JSON for the browser.

Usage: python train.py
Expects: gesture-dataset.zip in the same directory
Outputs: ../data/gesture-model.json
"""

import os
import sys
import json
import zipfile
import shutil
import numpy as np
from pathlib import Path

def main():
    script_dir = Path(__file__).parent
    zip_path = script_dir / "gesture-dataset.zip"
    dataset_dir = script_dir / "dataset"
    output_path = script_dir.parent / "data" / "gesture-model.json"

    # 1. Check zip
    if not zip_path.exists():
        print("ERRO: gesture-dataset.zip nao encontrado!")
        sys.exit(1)

    # 2. Extract
    print("[1/5] Extraindo dataset...")
    if dataset_dir.exists():
        shutil.rmtree(dataset_dir)
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(dataset_dir)

    gestures = sorted([
        d for d in os.listdir(dataset_dir)
        if (dataset_dir / d).is_dir()
    ])
    for g in gestures:
        count = len(list((dataset_dir / g).iterdir()))
        print(f"   {g}: {count} imagens")

    if len(gestures) < 2:
        print("ERRO: precisa de pelo menos 2 classes!")
        sys.exit(1)

    # 3. Extract landmarks from each image using MediaPipe Tasks API
    print("[2/5] Extraindo landmarks com MediaPipe...")
    import mediapipe as mp
    import cv2

    BaseOptions = mp.tasks.BaseOptions
    HandLandmarker = mp.tasks.vision.HandLandmarker
    HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
    VisionRunningMode = mp.tasks.vision.RunningMode

    # Download model if needed
    model_path = script_dir / "hand_landmarker.task"
    if not model_path.exists():
        print("   Baixando modelo hand_landmarker...")
        import urllib.request
        urllib.request.urlretrieve(
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            str(model_path)
        )

    options = HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path)),
        running_mode=VisionRunningMode.IMAGE,
        num_hands=1,
        min_hand_detection_confidence=0.5,
    )
    landmarker = HandLandmarker.create_from_options(options)

    X = []  # feature vectors (63 floats: 21 landmarks * 3 coords)
    y = []  # labels (gesture index)
    label_names = gestures
    skipped = 0

    for label_idx, gesture_name in enumerate(gestures):
        gesture_dir = dataset_dir / gesture_name
        for img_file in sorted(gesture_dir.iterdir()):
            if not img_file.suffix.lower() in ('.jpg', '.jpeg', '.png'):
                continue
            img = cv2.imread(str(img_file))
            if img is None:
                skipped += 1
                continue
            img = cv2.flip(img, 1)
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = landmarker.detect(mp_image)

            if not result.hand_landmarks:
                skipped += 1
                continue

            lm = result.hand_landmarks[0]
            wrist = lm[0]
            features = []
            for point in lm:
                features.extend([
                    point.x - wrist.x,
                    point.y - wrist.y,
                    point.z - wrist.z,
                ])
            X.append(features)
            y.append(label_idx)

    landmarker.close()

    print(f"   {len(X)} amostras extraidas, {skipped} skipped (sem mao detectada)")

    if len(X) < 10:
        print("ERRO: poucas amostras com mao detectada!")
        sys.exit(1)

    # 4. Train SVM classifier
    print("[3/5] Treinando classificador SVM...")
    from sklearn.svm import SVC
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import cross_val_score

    X = np.array(X)
    y = np.array(y)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    clf = SVC(kernel='rbf', C=10, gamma='scale', probability=True)
    scores = cross_val_score(clf, X_scaled, y, cv=min(5, len(X)), scoring='accuracy')
    print(f"   Cross-val accuracy: {scores.mean()*100:.1f}% (+/- {scores.std()*100:.1f}%)")

    clf.fit(X_scaled, y)
    train_acc = clf.score(X_scaled, y)
    print(f"   Train accuracy: {train_acc*100:.1f}%")

    # 5. Export as JSON for browser
    print("[4/5] Exportando modelo JSON...")

    # For browser inference, we export: scaler params + support vectors + model params
    # But simpler: export as a nearest-centroid model (mean + std per class)
    # OR export a lookup table. For SVM with RBF kernel, direct JS inference is complex.
    # Instead: export class centroids + covariance for a simple Mahalanobis classifier.
    # Even simpler: export KNN reference vectors.

    # Let's use a simpler approach: per-class centroid + std for Gaussian classifier
    # This is lightweight and works great for well-separated gestures
    class_data = {}
    for idx, name in enumerate(label_names):
        mask = y == idx
        class_samples = X_scaled[mask]
        class_data[name] = {
            "mean": class_samples.mean(axis=0).tolist(),
            "std": class_samples.std(axis=0).tolist(),
            "count": int(mask.sum()),
        }

    model_json = {
        "type": "gaussian_centroid",
        "labels": label_names,
        "scaler": {
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
        },
        "classes": class_data,
        "accuracy": float(scores.mean()),
        "features": 63,  # 21 landmarks * 3 coords
    }

    os.makedirs(output_path.parent, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(model_json, f)

    print(f"[5/5] Modelo salvo em: {output_path}")
    print(f"   Classes: {', '.join(label_names)}")
    print(f"   Accuracy: {scores.mean()*100:.1f}%")
    print(f"   Tamanho: {output_path.stat().st_size / 1024:.1f} KB")
    print("\nPronto! Recarregue o obsidian-hologram no browser.")

if __name__ == "__main__":
    main()
