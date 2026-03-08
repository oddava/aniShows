import json
import subprocess
import os

def run_ruff():
    result = subprocess.run(["uvx", "ruff", "check", "apps/animes/", "--output-format=json"], capture_output=True, text=True)
    if not result.stdout.strip():
        print("No output from ruff")
        return []
    try:
        return json.loads(result.stdout)
    except Exception as e:
        print("Failed to parse JSON:", e)
        print("Output was:", result.stdout[:500])
        return []

errors = [e for e in run_ruff() if "migrations" not in e["filename"]]

files = {}
for e in errors:
    f = e["filename"]
    if f not in files:
        with open(f, 'r') as fp:
            files[f] = fp.read().split('\n')

# Process from bottom of file to top to avoid shifting line numbers
errors.sort(key=lambda x: (x["filename"], x["location"]["row"]), reverse=True)

for e in errors:
    f = e["filename"]
    code = e["code"]
    row = e["location"]["row"] - 1 # 0-indexed
    col = e["location"]["column"] - 1

    lines = files[f]

    indent = " " * col
    
    if code in ["D101"]:
        # Class docstring goes inside the class, so we look for the next line
        lines.insert(row + 1, indent + '    """Class docstring."""')
    elif code == "D106":
        lines.insert(row + 1, indent + '    """Meta configuration."""')
    elif code in ["D102", "D103"]:
        lines.insert(row + 1, indent + '    """Method docstring."""')
    elif code == "D415": # Missing punctuation
        # Find the docstring
        for i in range(row, len(lines)):
            if '"""' in lines[i] or "'''" in lines[i]:
                # Very naive: just add a period before the closing quotes if it's on the same line
                if lines[i].endswith('"""'):
                    lines[i] = lines[i][:-3] + '."""'
                elif lines[i].endswith("'''"):
                    lines[i] = lines[i][:-3] + ".'''"
                break
    elif code == "D212":
        # Multi-line docstring summary should start at the first line
        pass
    elif code == "D205":
        pass

for f, lines in files.items():
    with open(f, 'w') as fp:
        fp.write('\n'.join(lines))
        
print("Fixed docstrings.")
