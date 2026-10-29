from datetime import datetime,timezone
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.request import urlopen
from urllib.parse import urlencode
import json

queries=[('eduardshilov.com',kind) for kind in ['NS','A','AAAA','MX','TXT']]+[('www.eduardshilov.com',kind) for kind in ['A','AAAA','CNAME']]
def get_record(query):
    name,kind=query
    with urlopen('https://dns.google/resolve?'+urlencode({'name':name,'type':kind}),timeout=15) as response:
        result=json.load(response)
    return {'name':name,'type':kind,'status':result.get('Status'),'answers':result.get('Answer',[])}
with ThreadPoolExecutor(max_workers=4) as pool:
    records=list(pool.map(get_record,queries))
result={'checkedAt':datetime.now(timezone.utc).isoformat(),'resolver':'Google Public DNS','changesApplied':False,'records':records}
Path(__file__).resolve().parent.parent.joinpath('dns-before-migration.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'queries':len(records),'ns':[a['data'] for r in records if r['type']=='NS' for a in r['answers']],'changed':False}))
