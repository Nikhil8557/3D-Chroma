import numpy as np
import json
from sklearn.manifold import MDS
from scipy.ndimage import gaussian_filter1d

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

distance_matrix = 1.0 / (heatmap + 1e-5)

# Optional: Cap max distance to prevent unconnected regions from flying off to infinity
max_dist = np.percentile(distance_matrix, 95)
distance_matrix = np.clip(distance_matrix, 0, max_dist)

# 3. Use Multidimensional Scaling (MDS) to solve 3D coordinates
print("Folding chromatin in 3D using MDS...")
mds = MDS(n_components=3, dissimilarity="precomputed", random_state=42, n_init=1, max_iter=300)
coords3d = mds.fit_transform(distance_matrix)

x, y, z = coords3d[:, 0], coords3d[:, 1], coords3d[:, 2]

# 4. Smooth the result for aesthetic rendering (persistence length)
sigma = 1.5 
x = gaussian_filter1d(x, sigma)
y = gaussian_filter1d(y, sigma)
z = gaussian_filter1d(z, sigma)

# 5. Export
js_data = {
    "x": x.tolist(),
    "y": y.tolist(),
    "z": z.tolist(),
    "colors": ["#5dade2"] * N,
    "ev": [0.5] * N,
    "loops": loops,
    "tad_boundaries": [] 
}

# Save to file
with open("chromatin_data.json", "w") as f:
    json.dump(js_data, f)
