#!/usr/bin/env python3
"""
Generate a TypeScript module with embedded ASCII frames
This avoids filesystem access issues in the bundled app
"""

import os
import json

def load_frames(frame_dir):
    """Load all ASCII frames from directory"""
    frames = []
    
    # Get all frame files
    files = sorted([f for f in os.listdir(frame_dir) if f.startswith("ascii_frame_") and f.endswith(".txt")])
    
    for file in files:
        with open(os.path.join(frame_dir, file), 'r') as f:
            content = f.read()
            frames.append(content)
    
    return frames

def generate_typescript_module(frames, output_path):
    """Generate a TypeScript module with embedded frames"""
    
    # Escape frames for TypeScript
    escaped_frames = []
    for frame in frames:
        # Escape backticks and backslashes
        escaped = frame.replace('\\', '\\\\').replace('`', '\\`').replace('$', '\\$')
        escaped_frames.append(escaped)
    
    module_content = f"""// Auto-generated ASCII avatar frames
export const AVATAR_FRAMES: string[] = [
"""
    
    # Add each frame as a template literal
    for i, frame in enumerate(escaped_frames):
        module_content += f"  `{frame}`"
        if i < len(escaped_frames) - 1:
            module_content += ","
        module_content += "\n"
    
    module_content += "];\n\n"
    module_content += f"export const FRAME_COUNT = {len(frames)};\n"
    module_content += "export const FPS = 12;\n"
    
    # Add the frame dimensions
    if frames:
        lines = frames[0].split('\n')
        height = len(lines)
        width = len(lines[0]) if lines else 0
        module_content += f"export const FRAME_WIDTH = {width};\n"
        module_content += f"export const FRAME_HEIGHT = {height};\n"
    
    with open(output_path, 'w') as f:
        f.write(module_content)
    
    print(f"Generated {output_path} with {len(frames)} frames")

def main():
    # Path to the ASCII frames
    frame_dir = os.path.expanduser("~/Dev/herm/docs/nous_ascii_frames_final_inverted")
    output_path = os.path.expanduser("~/Dev/herm/src/avatar-frames.ts")
    
    if not os.path.exists(frame_dir):
        print(f"Error: Frame directory not found: {frame_dir}")
        return
    
    frames = load_frames(frame_dir)
    generate_typescript_module(frames, output_path)

if __name__ == "__main__":
    main()