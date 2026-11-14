"""Quick manual test for app.serper: run 3 queries and report filtering stats.

Run from the backend/ folder (needs SERPER_API_KEY in .env):
    python test_serper.py

For each query it prints:
  - how many raw organic results came back
  - how many profiles were kept after filtering/deduping
  - each kept username with its snippet
"""

from app.serper import build_queries, search_organic, search_instagram_profiles

# Just the first three queries for a cheap manual run.
queries = build_queries()[:3]

for query in queries:
    print(f"Query: {query}")

    try:
        organic = search_organic(query)  # raw page-1 results from Serper
        profiles = search_instagram_profiles(query)  # filtered result
    except Exception as exc:  # SerperError or missing key — show it plainly
        print(f"  FAIL: {exc}\n")
        continue

    print(f"  raw organic results: {len(organic)}")
    print(f"  profiles kept:       {len(profiles)}")
    for item in profiles:
        print(f"    {item['username']}")
        print(f"      {item['snippet'][:100]}")
    print()
