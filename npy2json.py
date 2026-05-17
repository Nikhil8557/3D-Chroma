import numpy as np
import json

# 1. Load your .npy EPI heatmap
heatmap = np.load("epi_interactions.npy") 
N = heatmap.shape[0]

# 2. Extract significant interactions (thresholding)
threshold = np.percentile(heatmap, 99) # Top 1% of interactions
loops = []
for i in range(N):
    for j in range(i + 3, N): # Ignore diagonal/adjacent bins
        if heatmap[i, j] > threshold:
            # Normalize score between 0.0 and 1.0 for the JS script
            score = float((heatmap[i, j] - threshold) / (np.max(heatmap) - threshold))
            loops.append({
                "a": i, 
                "b": j, 
                "score": score,
                "color": "#ff3333" if score > 0.7 else "#f39c12" # Color by intensity
            })

# 3. Create mock 3D coordinates (If you don't already have them from something like Pastis/3DMax)
# For the sake of example, generating a random walk
x, y, z = [0.0], [0.0], [0.0]
for i in range(1, N):
    x.append(x[-1] + np.random.randn())
    y.append(y[-1] + np.random.randn())
    z.append(z[-1] + np.random.randn())

# 4. Construct the final JSON object
js_data = {
    "x": x,
    "y": y,
    "z": z,
    "colors": ["#5dade2"] * N,
    "ev": [0.5] * N, # Eigenvector for Compartments A/B
    "loops": loops,
    "tad_boundaries": [] 
}

# Save to file
with open("chromatin_data.json", "w") as f:
    json.dump(js_data, f)