import sys

def extract_blocks(filename):
    with open(filename, 'r') as f:
        content = f.read()
    
    # Simple brace matching
    # We want to find `[data-theme="retro-anime"] {` and extract the whole block
    
    start_idx = content.find('[data-theme="retro-anime"]')
    if start_idx == -1:
        print("Not found")
        return
        
    brace_count = 0
    in_block = False
    end_idx = -1
    
    for i in range(start_idx, len(content)):
        if content[i] == '{':
            brace_count += 1
            in_block = True
        elif content[i] == '}':
            brace_count -= 1
            if in_block and brace_count == 0:
                end_idx = i
                break
                
    if end_idx != -1:
        block = content[start_idx:end_idx+1]
        print(f"Start: {start_idx}, End: {end_idx}, Lines: {block.count(chr(10))}")
        with open('frontend/src/styles/themes/retro-anime.css', 'w') as out:
            out.write("@layer base {\n")
            out.write(block)
            out.write("\n}\n")
            
        # Write remaining
        new_content = content[:start_idx] + "  /* retro-anime theme moved to styles/themes/retro-anime.css */" + content[end_idx+1:]
        with open('frontend/src/index.css.tmp', 'w') as out:
            out.write(new_content)
    else:
        print("End not found")

extract_blocks('frontend/src/index.css')
