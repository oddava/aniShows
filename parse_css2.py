import sys

def extract_blocks(filename, block_name, out_file):
    with open(filename, 'r') as f:
        content = f.read()
    
    start_idx = content.find(block_name)
    if start_idx == -1:
        print(f"{block_name} Not found")
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
        print(f"{block_name} -> Lines: {block.count(chr(10))}")
        with open(out_file, 'w') as out:
            out.write("@layer base {\n")
            out.write(block)
            out.write("\n}\n")
            
        new_content = content[:start_idx] + f"/* {block_name} moved to {out_file} */" + content[end_idx+1:]
        with open(filename, 'w') as out:
            out.write(new_content)
    else:
        print("End not found")

extract_blocks('frontend/src/index.css.tmp', '[data-theme="retro-crt"]', 'frontend/src/styles/themes/retro-crt.css')
