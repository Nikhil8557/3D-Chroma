import numpy as np
import json
import os
from sklearn.manifold import MDS
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks

# ==========================================
# 0. LOAD OR MOCK DATA
# ==========================================
filename = "epi_interactions.npy"
if os.path.exists(filename):
    heatmap = np.load(filename)
    N = heatmap.shape[0]
else:
    print(f"File {filename} not found. Generating dummy Hi-C heatmap...")
    N = 500
    heatmap = np.ones((N, N)) * 0.1
    # Create fake block-diagonal TADs
    for i in range(0, N, 50):
        heatmap[i:i+50, i:i+50] += 5.0
        # Add high interaction at the boundaries (CTCF loops)
        heatmap[i, min(i+49, N-1)] += 10.0 
        heatmap[min(i+49, N-1), i] += 10.0

# ==========================================
# STEP 1: CALCULATE TAD BOUNDARIES
# ==========================================
print("Calculating TAD boundaries...")
window = 5 
insulation_scores = np.zeros(N)

for i in range(N):
    start = max(0, i - window)
    end = min(N, i + window)
    insulation_scores[i] = np.sum(heatmap[start:end, start:end])

smoothed_insulation = gaussian_filter1d(insulation_scores, sigma=1.0)
valleys, _ = find_peaks(-smoothed_insulation, distance=window)

# Ensure the very start and end of the chromosome are included as boundaries
boundaries = [0] + valleys.tolist()
if boundaries[-1] != N - 1:
    boundaries.append(N - 1)
boundaries = np.array(boundaries)
num_boundaries = len(boundaries)

# Assign TAD IDs to bins
tad_ids = np.zeros(N, dtype=int)
for i in range(num_boundaries - 1):
    tad_ids[boundaries[i]:boundaries[i+1]+1] = i
num_tads = num_boundaries - 1

# ==========================================
# STEP 2: SOLVE MACRO-BACKBONE (ANCHORING BOUNDARIES)
# ==========================================
print("Solving 3D macro-backbone using TAD boundaries...")

# Extract interactions strictly between boundary bins
boundary_interactions = heatmap[np.ix_(boundaries, boundaries)]
# Convert interactions to physical distances
boundary_distances = 1.0 / (boundary_interactions + 1e-5)

# BIOLOGICAL HYBRID TWEAK: Enforce Loop Extrusion Pinching
# We artificially reduce the distance between consecutive boundaries (the start and end of a TAD)
# to force the MDS algorithm to place them physically close together, creating a pinched loop base.
for i in range(num_boundaries - 1):
    boundary_distances[i, i+1] /= 3.0  
    boundary_distances[i+1, i] /= 3.0  

# Run MDS ONLY on the boundaries (Massively faster than running on all N bins)
mds = MDS(n_components=3, dissimilarity="precomputed", random_state=42, n_init=3, max_iter=500)
boundary_coords3d = mds.fit_transform(boundary_distances)

# ==========================================
# STEP 3: BROWNIAN BRIDGE FOR PUFFED TAD LOOPS
# ==========================================
print("Generating continuous chromatin loops via Brownian Bridges...")

final_coords = np.zeros((N, 3))
final_coords[boundaries] = boundary_coords3d # Lock boundaries exactly into place
is_anchor = [False] * N

for i in range(num_boundaries - 1):
    b_start = boundaries[i]
    b_end = boundaries[i+1]
    length = b_end - b_start
    
    is_anchor[b_start] = True
    
    if length <= 1:
        continue # Already assigned
        
    A = boundary_coords3d[i]   # 3D Coordinate of TAD Start
    B = boundary_coords3d[i+1] # 3D Coordinate of TAD End
    
    # 3A. Generate a 3D Random Walk (Brownian Motion)
    steps = np.random.randn(length + 1, 3)
    W = np.cumsum(steps, axis=0)
    
    # Smooth the random walk so it looks like a continuous fiber
    W = gaussian_filter1d(W, sigma=1.5, axis=0)
    W -= W[0] # Force the random walk to start exactly at (0,0,0)
    
    # Scale the "puffiness" of the loop based on how many bins are inside the TAD
    puff_scale = 1.5 * np.sqrt(length) 
    W_scaled = W * puff_scale
    
    # 3B. Apply the Brownian Bridge Equation
    # Formula: Bridge(t) = A + t*(B - A) + W(t) - t*W(end)
    # This mathematically guarantees the curve starts exactly at A and ends exactly at B!
    t = np.linspace(0, 1, length + 1).reshape(-1, 1)
    bridge_coords = A + t * (B - A) + W_scaled - t * W_scaled[-1]
    
    # Assign the calculated loop to the final geometry
    final_coords[b_start:b_end+1] = bridge_coords

# Ensure final bin is marked as an anchor
is_anchor[boundaries[-1]] = True

# Extract axis components
x, y, z = final_coords[:, 0], final_coords[:, 1], final_coords[:, 2]

# ==========================================
# STEP 4: PREPARE EXPORT DATA
# ==========================================
# Create sequential polymer links
polymer_chain = [{"source": i, "target": i + 1} for i in range(N - 1)]

# Assign colors by TAD
palette = ["#e74c3c", "#3498db", "#2ecc71", "#9b59b6", "#f1c40f", "#e67e22", "#1abc9c"]
colors = [palette[tad_ids[i] % len(palette)] for i in range(N)]

# Export to JSON
js_data = {
    "num_nodes": N,
    "x": x.tolist(),
    "y": y.tolist(),
    "z": z.tolist(),
    "colors": colors,
    "tad_id": tad_ids.tolist(),
    "is_anchor": is_anchor, # True if the bin is a biological TAD boundary
    "tad_boundaries": boundaries.tolist(), 
    "links": polymer_chain
}

with open("chromatin_data.json", "w") as f:
    json.dump(js_data, f)

print(f"Success! Saved hybrid loop-extrusion structure ({num_tads} TADs) to chromatin_data.json.")
