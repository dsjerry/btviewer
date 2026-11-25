# People collections: face analysis

[简体中文](./face-analysis.md)

People collections analyse **fully downloaded** videos in the background, detect the faces that appear in them, and group them automatically into "people" by similarity. All processing happens on this machine; no frames or face data are uploaded. The feature is off by default and is enabled under **Settings → People collections**.

## Enabling and models

Enabling it first shows a confirmation dialog explaining that about 42 MB of models will be downloaded:

| Model | Purpose | Size | Source |
| --- | --- | --- | --- |
| `face_landmarker.task` | Face detection and 478 landmarks (MediaPipe) | ~3.8 MB | Google's official storage |
| `face_recognition_sface_2021dec.onnx` | 128-dimensional face embedding (SFace, ONNX) | ~38.7 MB | Hugging Face `opencv/face_recognition_sface` (Apache-2.0) |

Models are stored under `models/` in the app data directory. Each download is verified against a pinned SHA256; a failed check is not installed. The ONNX Runtime WASM runtime ships with the app, so no network access is needed at analysis time.

## Sequence diagram

```mermaid
sequenceDiagram
    autonumber
    participant UI as Settings / People page
    participant R as Renderer analysis loop
    participant M as Main process people-store
    participant F as ffmpeg / ffprobe
    participant ML as FaceLandmarker
    participant SF as SFace (ONNX)

    UI->>M: enable people collections (models ready)
    loop each pending video
        R->>M: peopleNextJob()
        M->>M: only fully downloaded videos (completed task files or non-missing local entries)
        M->>F: ffprobe for duration
        M-->>R: { key, path, duration }
        loop each sample time
            R->>M: peopleFrame(path, t)
            M->>F: ffmpeg -ss t (width ≤ 960px, JPEG)
            M-->>R: JPEG bytes
            R->>ML: detect(bitmap) → 478 points
            R->>R: drop small faces (short side < 48px)
            R->>R: 5-point similarity alignment to 112×112
            R->>SF: RGB 0–255, NCHW
            SF-->>R: 128-d feature → L2 normalise
        end
        R->>M: peopleSubmit(key, duration, drafts)
        M->>M: compare with person centroids, join if ≥ 0.4 else create
        M->>M: write people.json, record analysed video
        M-->>UI: people:changed (UI refresh debounced 800 ms)
    end
```

## Flowchart

```mermaid
flowchart TD
    A[App start / enable people collections] --> B{Models installed?}
    B -- No --> C[Confirm, download and verify models]
    C --> B
    B -- Yes --> D[Start background analysis loop]
    D --> E{Player page open?}
    E -- Yes --> P[Pause analysis]
    P --> E
    E -- No --> F{Pending videos?}
    F -- No --> W[Wait 60 s, then check again]
    W --> E
    F -- Yes --> G[Sample frames, detect, align, embed]
    G --> H[Submit to main process, cluster and store]
    H --> D
```

## Clustering rules

- Each face is compared by cosine similarity with the **centroid** of each existing person. If the best score is ≥ **0.4** the face joins that person; otherwise a new person is created. The threshold is a conservative default and should be calibrated on real footage.
- Person thumbnails are ordered by similarity to the centroid, so the most representative faces come first.
- When merging, an unnamed target inherits the source's name. If both are named, the target's name is kept.

## Sampling

- Sample interval = `max(5 s, duration / 60)`; at most about 60 frames per video. The first interval and the last second are skipped.
- A frame that fails to decode or infer is skipped. If a whole video fails, the loop backs off for 5 seconds.
- Videos whose probe fails are not retried during the same run.

## Data and privacy

- Data lives in `people.json` in the app data directory: people, face embeddings (128-dimensional vectors), aligned thumbnails (JPEG, a few KB each) and the analysed-video record.
- Video files are never modified.
- **Settings → People collections → Clear people data** deletes all of the above and turns the feature off.

## Relationship with other features

- Analysis pauses while the player page is open, so it does not compete with video decoding.
- People can be used as a library filter, and as the "includes person" condition of smart collections (see the [README](../README.en.md)).
- Gesture control shares the MediaPipe runtime, but its models are separate (see [Gesture control](./gesture-control.en.md)).

## Known limitations

- The clustering threshold has not been calibrated on real data, so faces may be merged or split incorrectly. Use the People page to merge or split manually.
- The person detail view shows at most 120 face thumbnails.
- Data is stored as JSON. With very large libraries (tens of thousands of faces) the file and summary computation will get slower; migrating to a database is a possible future step.
- The training-data licence of SFace has not been verified and must be checked before release.
