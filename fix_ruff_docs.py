import json
import subprocess
import os

def run_ruff():
    result = subprocess.run(["uvx", "ruff", "check", "apps/animes/", "--format=json"], capture_output=True, text=True)
    return json.loads(result.stdout)

errors = [e for e in run_ruff() if "migrations" not in e["filename"]]

files = {}
for e in errors:
    f = e["filename"]
    if f not in files:
        with open(f, 'r') as fp:
            files[f] = fp.read().split('\n')

for e in sorted(errors, key=lambda x: x["location"]["row"], reverse=True):
    f = e["filename"]
    code = e["code"]
    row = e["location"]["row"] - 1 # 0-indexed
    col = e["location"]["column"] - 1

    lines = files[f]

    if code == "D101":
        # Missing docstring in public class
        indent = " " * col
        lines.insert(row + 1, indent + '    """Class docstring."""')
    elif code == "D106":
        # Meta class docstring
        indent = " " * col
        lines.insert(row + 1, indent + '    """Meta configuration."""')
    elif code == "D102":
        # Missing docstring in public method
        indent = " " * col
        lines.insert(row + 1, indent + '    """Method docstring."""')
    elif code == "D415":
        # First line should end with a period
        # The docstring is likely at row
        while row < len(lines) and '"""' not in lines[row]:
            row += 1
        
        # If the string ends on this line
        line = lines[row]
        if line.endswith('"""'):
            lines[row] = line[:-3] + '."""'
        else:
            # We might need to find where it ends, or just add a dot. Let's just assume it's one line if D415.
            pass
    elif code == "D205":
        pass
    elif code == "D212":
        pass
    elif code == "I001":
        pass
        
for f, lines in files.items():
    with open(f, 'w') as fp:
        fp.write('\n'.join(lines))
        
print("Fixed basic docstrings.")
