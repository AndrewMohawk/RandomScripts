import requests
from urllib.parse import parse_qs
from random import randint

# Username and Password to login
username = "AndrewMohawk"
password = "DoesntEvenPlayValorant"

# Set the Ciphers to avoid JAS/JA3 fingerprinting from CF
# Taken from https://github.com/floxay/python-riot-auth/blob/main/riot_auth/auth.py#L40
CIPHERS13 = ":".join(  # https://docs.python.org/3/library/ssl.html#tls-1-3
        (
            "TLS_CHACHA20_POLY1305_SHA256",
            "TLS_AES_128_GCM_SHA256",
            "TLS_AES_256_GCM_SHA384",
        )
    )
CIPHERS = ":".join(
    (
        "ECDHE-ECDSA-CHACHA20-POLY1305",
        "ECDHE-RSA-CHACHA20-POLY1305",
        "ECDHE-ECDSA-AES128-GCM-SHA256",
        "ECDHE-RSA-AES128-GCM-SHA256",
        "ECDHE-ECDSA-AES256-GCM-SHA384",
        "ECDHE-RSA-AES256-GCM-SHA384",
        "ECDHE-ECDSA-AES128-SHA",
        "ECDHE-RSA-AES128-SHA",
        "ECDHE-ECDSA-AES256-SHA",
        "ECDHE-RSA-AES256-SHA",
        "AES128-GCM-SHA256",
        "AES256-GCM-SHA384",
        "AES128-SHA",
        "AES256-SHA",
        "DES-CBC3-SHA",  # most likely not available
    )
)
SIGALGS = ":".join(
    (
        "ecdsa_secp256r1_sha256",
        "rsa_pss_rsae_sha256",
        "rsa_pkcs1_sha256",
        "ecdsa_secp384r1_sha384",
        "rsa_pss_rsae_sha384",
        "rsa_pkcs1_sha384",
        "rsa_pss_rsae_sha512",
        "rsa_pkcs1_sha512",
        "rsa_pkcs1_sha1",  # will get ignored and won't be negotiated
    )
)

# Lets set the request ciphers
requests.packages.urllib3.util.ssl_.DEFAULT_CIPHERS = CIPHERS
requests.packages.urllib3.util.ssl_.DEFAULT_CIPHERS13 = CIPHERS13
requests.packages.urllib3.util.ssl_.DEFAULT_SIGALGS = SIGALGS


# These arent used but if you need to just uncomment and set proxies=proxies and verify=False for each request
# proxies = {
#     "http": "http://localhost:8080",
#     "https": "http://localhost:8080",
# }

# Lets create a session so we can keep cookies
s = requests.Session()

################################
# First lets get the CF cookies
################################
headers = {
    'authority': 'auth.riotgames.com',
    'Content-Type': 'application/json',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36'
}

initial_request_get_cf_headers = s.get('https://auth.riotgames.com/', headers=headers)

if(initial_request_get_cf_headers.status_code != 200):
    print("[!] Failed to get CF headers")
    exit(1)

print("[+] Got CF headers")
#print(initial_request_get_cf_headers.cookies['__cf_bm'])

################################
# Now lets do a POST request to collect riot cookies
################################

headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/112.0',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
    'Referer': 'https://auth.riotgames.com/',
    'Content-Type': 'application/json',
    'Origin': 'https://auth.riotgames.com',
    'Dnt': '1',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'Te': 'trailers',
}

data = {
    "client_id": "play-valorant-web-prod",
    "nonce": "1",
    "redirect_uri": "https://playvalorant.com/opt_in",
    "response_type": "token id_token",
    "scope": "account openid"
}

post_request = s.post('https://auth.riotgames.com/api/v1/authorization', headers=headers, json=data)
if(post_request.status_code != 200):
    print("[!] Failed to send POST Req")
    exit(1)

print("[+] Got POST Req Cookies")
#print(post_request.cookies)


################################
# Now lets do a PUT request to get the access token (aka login)
################################

data = {
    "type": "auth",
    "username": username,
    "password": password,
    "remember": True,
    "language": "en_US"
}

# Lets use the cookies from the last request
s.cookies = post_request.cookies
access_token = False

put_request = s.put('https://auth.riotgames.com/api/v1/authorization', headers=headers, json=data)

put_response_json = put_request.json()
if(put_request.status_code != 200):
    print("[+] Failed to get put request")
    exit(1)
else:
    print("[+] Got PUT Req Auth, looking for URI with token")
    #lol lazy.
    try:
        access_token = put_response_json['response']['parameters']['uri']
        print("[+] Got access token")
    except:
        print("[!] Failed to get access token, is your username and password correct?")
        print(put_response_json)
        exit(1)

# Fetch the access token from the URI with parse_qs
access_token_params = parse_qs(access_token)
bearer_token = access_token_params['https://playvalorant.com/opt_in#access_token'][0]


################################
# Now lets do a POST request to get the entitlements token
################################
#POST request to https://entitlements.auth.riotgames.com/api/token/v1 with the bearer token
headers = {
    'Authorization': f'Bearer {bearer_token}',
    'Content-Type': 'application/json',
}

fetch_entitlements = s.post('https://entitlements.auth.riotgames.com/api/token/v1', headers=headers)
if(fetch_entitlements.status_code != 200):
    print("[!] Failed to get entitlements")
    exit(1)

print("[+] Got entitlements")
entitlements_json = fetch_entitlements.json()
entitlement_jwt = entitlements_json['entitlements_token']

################################
# Now we have the entitlement JWT token, lets use it to get the player info
################################

# Lets get the player info from https://auth.riotgames.com/userinfo
data = s.get('https://auth.riotgames.com/userinfo', headers=headers)
playerinfo = False
if(data.status_code != 200):
    print("[!] Failed to get player info")
    exit(1)

print("[+] Got player info")
print(data.json())
playerinfo = data.json()

################################
# Fetch the match history
################################

#lets get the match history from https://pd.{shard}.a.pvp.net/match-history/v1/history/{puuid}?startIndex={startIndex}&endIndex={endIndex}&queue={queue}
shard = 'na'
puuid = playerinfo['sub']
startIndex = 0
endIndex = 20

url = f"https://pd.{shard}.a.pvp.net/match-history/v1/history/{puuid}?startIndex={startIndex}&endIndex={endIndex}"
headers['x-riot-entitlements-jwt'] = entitlement_jwt
match_history = False
match_history_request = s.get(url, headers=headers)
if(match_history_request.status_code != 200):
    print("[!] Failed to get match history")
    exit(1)

print("[+] Got match history..")
print(match_history_request.json())
match_history = match_history_request.json()


################################
# Lets get a random match from the history to show it works
################################
num_matches = len(match_history['History'])
random_match = randint(0, num_matches-1)
match_id = match_history['History'][random_match]['MatchID']


url = f"https://pd.{shard}.a.pvp.net/match-details/v1/matches/{match_id}"
match_details = False
match_details_request = s.get(url, headers=headers)
if(match_details_request.status_code != 200):
    print("[!] Failed to get match details")
    exit(1)

print("[+] Got match details..")
print(match_details_request.json())
match_details = match_details_request.json()