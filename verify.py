import urllib.request

for path in ['/api/v1/health', '/api/v1/post/list?page=1&pageSize=1', '/api/v1/service/list']:
    try:
        r = urllib.request.urlopen('https://payun01.cn' + path, timeout=10)
        print(r.status, path)
    except Exception as e:
        print('ERROR:', e, path)
