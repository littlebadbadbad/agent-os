"""Simple script to parse lcov.info and print coverage summary per directory."""
import sys
import os
from collections import defaultdict

def parse_lcov(path):
    with open(path, 'r') as f:
        content = f.read()
    
    files = content.split('end_of_record')
    dirs = defaultdict(lambda: {'da': 0, 'da_hit': 0, 'fnda': 0, 'fnda_hit': 0, 'brda': 0, 'brda_hit': 0})
    
    for f_data in files:
        if not f_data.strip():
            continue
        lines = f_data.strip().split('\n')
        sf = ''
        for line in lines:
            if line.startswith('SF:'):
                sf = line[3:].replace('/', os.sep)
                # Get top-level directory
                parts = sf.split(os.sep)
                if len(parts) >= 2:
                    top_dir = parts[0]
                else:
                    top_dir = sf
            elif line.startswith('DA:'):
                parts = line.split(',')
                if len(parts) >= 2:
                    dirs[sf]['da'] += 1
                    if int(parts[1]) > 0:
                        dirs[sf]['da_hit'] += 1
            elif line.startswith('FNDA:'):
                parts = line.split(',')
                if len(parts) >= 2:
                    dirs[sf]['fnda'] += 1
                    if int(parts[0].split(':')[1]) > 0:
                        dirs[sf]['fnda_hit'] += 1
            elif line.startswith('BRDA:'):
                parts = line.split(',')
                if len(parts) >= 4:
                    dirs[sf]['brda'] += 1
                    if parts[3].strip() not in ('-', '0'):
                        dirs[sf]['brda_hit'] += 1
    
    # Aggregate by top-level dir
    agg = defaultdict(lambda: {'da': 0, 'da_hit': 0, 'fnda': 0, 'fnda_hit': 0, 'brda': 0, 'brda_hit': 0})
    for sf, data in dirs.items():
        parts = sf.split(os.sep)
        top = parts[0] if len(parts) >= 2 else 'root'
        for k, v in data.items():
            agg[top][k] += v
    
    print(f"{'Directory':<20} {'Lines':>8} {'Hit%':>8} {'Fns':>6} {'Fn%':>7} {'Branches':>10} {'Br%':>8}")
    print("-" * 70)
    for top in sorted(agg.keys()):
        d = agg[top]
        line_pct = (d['da_hit'] / d['da'] * 100) if d['da'] > 0 else 0
        fn_pct = (d['fnda_hit'] / d['fnda'] * 100) if d['fnda'] > 0 else 0
        br_pct = (d['brda_hit'] / d['brda'] * 100) if d['brda'] > 0 else 0
        print(f"{top:<20} {d['da']:>8} {line_pct:>7.1f}% {d['fnda']:>6} {fn_pct:>6.1f}% {d['brda']:>10} {br_pct:>7.1f}%")
    
    # Totals
    total_da = sum(d['da'] for d in agg.values())
    total_hit = sum(d['da_hit'] for d in agg.values())
    total_fn = sum(d['fnda'] for d in agg.values())
    total_fn_hit = sum(d['fnda_hit'] for d in agg.values())
    total_br = sum(d['brda'] for d in agg.values())
    total_br_hit = sum(d['brda_hit'] for d in agg.values())
    print("-" * 70)
    print(f"{'TOTAL':<20} {total_da:>8} {total_hit/total_da*100:>7.1f}% {total_fn:>6} {total_fn_hit/total_fn*100:>6.1f}% {total_br:>10} {total_br_hit/total_br*100:>7.1f}%")

if __name__ == '__main__':
    parse_lcov(sys.argv[1])
