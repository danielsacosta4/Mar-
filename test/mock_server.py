import time
import json, io, math, struct, random, hashlib, sys, os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from PIL import Image, ImageDraw
ROOT = sys.argv[1]
random.seed(4)
COLORS = [(214,72,52),(40,90,170),(230,180,40),(30,140,110),(120,60,160),(240,120,150),(20,20,30),(200,200,190),(90,160,220),(160,90,40),(60,60,60),(250,90,40)]
artists = [("ar1","Lua Azul"),("ar2","The Northern Lights"),("ar3","Marta Fado"),("ar4","Kilo Echo"),("ar5","Sal & Pimenta")]
genres = ["Indie","Fado","Electronic","Jazz","Rock"]
albums=[]; songs=[]
names=["Maré Alta","Night Drive","Saudade","Neon Rivers","Glass Harbor","Old Tram 28","Static Bloom","Atlântico","Paper Suns","Low Tide","Kerosene","Lisboa 4AM"]
for i,n in enumerate(names):
    ar=artists[i%5]; aid=f"al{i}"
    tr=[]
    for t in range(1,9):
        sid=f"so{i}_{t}"
        s=dict(id=sid,title=f"{n.split()[0]} Song {t}" if t>1 else n,artist=ar[1],artistId=ar[0],album=n,albumId=aid,coverArt=aid,duration=40+t*7,track=t,discNumber=1,year=1975+i*4,genre=genres[i%5],isDir=False)
        if (i+t)%7==0: s["starred"]="2026-01-01T00:00:00Z"
        s.update(suffix="flac", bitRate=2300 if i%2 else 900, bitDepth=24 if i%2 else 16, samplingRate=96000 if i%2 else 44100)
        if i==5: s.update(suffix="mp3", bitRate=320, samplingRate=44100); s.pop("bitDepth")      # a lossy album
        if i==9: s.update(bitRate=4600, samplingRate=192000)                                      # 24/192
        if i not in (6,7,8,10): s["replayGain"]={"trackGain":-6.5-t*0.3,"albumGain":-7.0,"trackPeak":0.98,"albumPeak":0.99}
        s["size"]=int(s["bitRate"]*125*s["duration"]*40)
        if (i*8+t)%5==0: s["userRating"]=5
        elif (i*8+t)%7==0: s["userRating"]=4
        s["created"]=(["2024-03-02T10:00:00Z"]*7+["2024-06-11T10:00:00Z","2024-11-20T10:00:00Z","2025-02-03T10:00:00Z","2025-07-15T10:00:00Z","2026-01-09T10:00:00Z"])[i]   # a big first import, then a trickle
        s["playCount"]=(i*3+t)%9
        tr.append(s); songs.append(s)
    albums.append(dict(id=aid,name=n,artist=ar[1],artistId=ar[0],coverArt=aid,songCount=8,duration=sum(x["duration"] for x in tr),year=1975+i*4,genre=genres[i%5],playCount=random.randint(0,40),songs=tr,starred="2026-01-01T00:00:00Z" if i%4==0 else None,
        recordLabels=[{"name":"Valentim de Carvalho"}] if i%3==2 else None,releaseDate={"year":1975+i*4,"month":3,"day":14} if i%3==2 else None,
        releaseTypes=[["Album","EP","Single"][i%3]],played="2026-10-09T21:00:00Z" if i%2 else None,
        userRating={2:5,4:4,7:3}.get(i)))
# Credits on one album, as Navidrome reports them (OpenSubsonic "contributors").
for s in albums[2]['songs']:
    s['contributors']=[{"role":"composer","artist":{"id":"c1","name":"Amália Rodrigues"}},{"role":"performer","subRole":"portuguese guitar","artist":{"id":"c2","name":"Rui Lourenço"}},{"role":"producer","artist":{"id":"c3","name":"Pedro Lima"}}]
def strip(a): return {k:v for k,v in a.items() if k!="songs" and v is not None}
def ok(**kw): return {"subsonic-response":{"status":"ok","version":"1.16.1","openSubsonic":True,**kw}}
def tone():
    sr=8000; n=sr*8; buf=io.BytesIO()
    data=b''.join(struct.pack('<h',int(3000*math.sin(2*math.pi*440*i/sr))) for i in range(n))
    buf.write(b'RIFF'+struct.pack('<I',36+len(data))+b'WAVEfmt '+struct.pack('<IHHIIHH',16,1,1,sr,sr*2,2,16)+b'data'+struct.pack('<I',len(data))+data)
    return buf.getvalue()
WAV=tone()
log=[]
class H(SimpleHTTPRequestHandler):
    def __init__(s,*a,**k): super().__init__(*a,directory=ROOT,**k)
    def log_message(s,*a): pass
    def send_json(s,obj):
        b=json.dumps(obj).encode(); s.send_response(200); s.send_header('Content-Type','application/json'); s.send_header('Content-Length',str(len(b))); s.end_headers(); s.wfile.write(b)
    def do_GET(s):
        u=urlparse(s.path)
        if u.path.startswith('/lb/1/'): return s.lb(u)
        if u.path.startswith('/mb/'): return s.mb(u)
        if not u.path.startswith('/rest/'): return super().do_GET()
        m=u.path[6:].replace('.view',''); q={k:v[0] for k,v in parse_qs(u.query).items()}
        log.append(m)
        tok=hashlib.md5(('secret'+q.get('s','')).encode()).hexdigest()
        if q.get('u')!='demo' or q.get('t')!=tok:
            return s.send_json({"subsonic-response":{"status":"failed","error":{"code":40,"message":"Wrong username or password"}}})
        if m=='ping': return s.send_json(ok())
        if m=='getCoverArt':
            idx=int(''.join(c for c in q['id'] if c.isdigit()) or 0)%len(COLORS); sz=int(q.get('size',300))
            im=Image.new('RGB',(sz,sz),COLORS[idx]); d=ImageDraw.Draw(im); d.ellipse((sz*.2,sz*.2,sz*.8,sz*.8),fill=tuple(255-c for c in COLORS[idx]))
            b=io.BytesIO(); im.save(b,'JPEG'); b=b.getvalue()
            s.send_response(200); s.send_header('Content-Type','image/jpeg'); s.send_header('Content-Length',str(len(b))); s.end_headers(); return s.wfile.write(b)
        if m=='stream':
            log.append('stream '+q['id']+' '+q.get('format','orig'))
            rng=s.headers.get('Range'); data=WAV
            if rng:
                a,b=rng.replace('bytes=','').split('-'); a=int(a or 0); b=int(b) if b else len(data)-1
                s.send_response(206); s.send_header('Content-Range',f'bytes {a}-{b}/{len(data)}'); data=data[a:b+1]
            else: s.send_response(200)
            s.send_header('Accept-Ranges','bytes'); s.send_header('Content-Type','audio/wav'); s.send_header('Content-Length',str(len(data))); s.end_headers(); return s.wfile.write(data)
        if m=='getAlbumList2':
            t=q['type']; L=albums[:]
            if t=='random': random.shuffle(L)
            elif t=='alphabeticalByName': L.sort(key=lambda a:a['name'])
            elif t=='frequent': L.sort(key=lambda a:-a['playCount'])
            elif t=='highest': L.sort(key=lambda a:-(a.get('userRating') or 0))
            elif t=='recent': L=L[3:9]
            elif t=='starred': L=[a for a in L if a.get('starred')]
            elif t=='byGenre': L=[a for a in L if a['genre']==q.get('genre')]
            elif t=='byYear': L=[a for a in L if int(q['fromYear'])<=a['year']<=int(q['toYear'])]
            off=int(q.get('offset',0)); size=int(q.get('size',10))
            return s.send_json(ok(albumList2={"album":[strip(a) for a in L[off:off+size]]}))
        if m=='getAlbum':
            a=next(a for a in albums if a['id']==q['id']); d=strip(a); d['song']=a['songs']; return s.send_json(ok(album=d))
        if m=='getAlbumInfo2':
            if q['id']=='al2': return s.send_json(ok(albumInfo={"notes":"Recorded over four nights in a small Alfama tavern, with the windows open to the street. <a href='https://www.last.fm/music/x'>Read more on Last.fm</a>"}))
            return s.send_json(ok(albumInfo={}))
        if m=='getArtists':
            return s.send_json(ok(artists={"index":[{"name":n[1][0],"artist":[{"id":n[0],"name":n[1],"coverArt":"ar-"+n[0][-1],"albumCount":3}]} for n in artists]}))
        if m=='getArtist':
            ar=next(x for x in artists if x[0]==q['id'])
            return s.send_json(ok(artist={"id":ar[0],"name":ar[1],"coverArt":"ar-"+ar[0][-1],"album":[strip(a) for a in albums if a['artistId']==ar[0]]}))
        if m=='getArtistInfo2':
            return s.send_json(ok(artistInfo2={"biography":"A <b>test</b> biography for this artist. <a href='x'>Read more</a>","similarArtist":[{"id":x[0],"name":x[1],"coverArt":"ar-"+x[0][-1]} for x in artists if x[0]!=q['id']][:3]}))
        if m=='getTopSongs':
            return s.send_json(ok(topSongs={"song":[x for x in songs if x['artist']==q['artist']][:5]}))
        if m=='getGenres':
            return s.send_json(ok(genres={"genre":[{"value":g,"songCount":10,"albumCount":3} for g in genres]}))
        if m=='getRandomSongs':
            L=songs[:]; random.shuffle(L); return s.send_json(ok(randomSongs={"song":L[:int(q.get('size',10))]}))
        if m=='getStarred2':
            return s.send_json(ok(starred2={"song":[x for x in songs if x.get('starred')],"album":[strip(a) for a in albums if a.get('starred')],"artist":[]}))
        if m=='search3':
            qq=q.get('query','').lower(); off=int(q.get('songOffset',0)); sc=int(q.get('songCount',20))
            so=[x for x in songs if qq in x['title'].lower() or qq in x['artist'].lower()]
            return s.send_json(ok(searchResult3={"artist":[{"id":a[0],"name":a[1],"coverArt":"ar-"+a[0][-1]} for a in artists if qq and qq in a[1].lower()],
              "album":[strip(a) for a in albums if qq and qq in a['name'].lower()],"song":so[off:off+sc]}))
        if m=='getPlaylists':
            return s.send_json(ok(playlists={"playlist":[{k:v for k,v in p.items() if k!='ids'}|{"songCount":len(p['ids'])} for p in PL.values()]}))
        if m=='getPlaylist':
            p=PL[q['id']]; return s.send_json(ok(playlist={k:v for k,v in p.items() if k!='ids'}|{"songCount":len(p['ids']),"entry":[SID[i] for i in p['ids']]}))
        if m=='createPlaylist':
            ids=parse_qs(u.query).get('songId',[])
            if 'playlistId' in q: PL[q['playlistId']]['ids']=ids; pid=q['playlistId']
            else:
                pid='pl%d'%(len(PL)+10); PL[pid]={"id":pid,"name":q['name'],"owner":"demo","coverArt":"pl-9","duration":0,"ids":ids}
            p=PL[pid]; return s.send_json(ok(playlist={k:v for k,v in p.items() if k!='ids'}|{"entry":[SID[i] for i in p['ids']]}))
        if m=='updatePlaylist':
            p=PL[q['playlistId']]; qq=parse_qs(u.query)
            if 'name' in q: p['name']=q['name']
            for i in sorted(map(int,qq.get('songIndexToRemove',[])),reverse=True): p['ids'].pop(i)
            p['ids']+=qq.get('songIdToAdd',[]); return s.send_json(ok())
        if m=='deletePlaylist':
            PL.pop(q['id'],None); return s.send_json(ok())
        if m=='getSimilarSongs2':
            L=[x for x in songs if x['id']!=q['id']]; random.shuffle(L); return s.send_json(ok(similarSongs2={"song":L[:int(q.get('count',20))]}))
        if m=='getSong':
            return s.send_json(ok(song=next(x for x in songs if x['id']==q['id'])))
        if m=='getLyricsBySongId':
            if q['id'].endswith('_2'):
                return s.send_json(ok(lyricsList={"structuredLyrics":[{"lang":"eng","synced":True,"offset":0,"line":[{"start":i*2500,"value":f"Synced line number {i+1} of this song"} for i in range(24)]}]}))
            return s.send_json(ok(lyricsList={"structuredLyrics":[]}))
        if m=='getLyrics':
            return s.send_json(ok(lyrics={}))
        if m=='startScan':
            SCAN['until']=time.time()+3; SCAN['n']+=1; log.append('startScan')
            return s.send_json(ok(scanStatus={"scanning":True,"count":len(songs)+SCAN['n']*2-2}))
        if m=='getScanStatus':
            busy=time.time()<SCAN['until']; k=SCAN['n']-(1 if busy else 0)
            return s.send_json(ok(scanStatus={"scanning":busy,"count":len(songs)+k*2,"lastScan":"2026-10-10T10:00:00Z" if not k else f"2026-10-13T10:00:0{k%10}Z"}))
        if m=='setRating':
            log.append('setRating '+q['id']+' '+q['rating']); n=int(q['rating'])
            for x in songs+albums:
                if x['id']==q['id']:
                    if n: x['userRating']=n
                    else: x.pop('userRating',None)
            return s.send_json(ok())
        if m in ('scrobble','star','unstar'):
            return s.send_json(ok())
        return s.send_json({"subsonic-response":{"status":"failed","error":{"code":0,"message":"unknown "+m}}})
SID={x['id']:x for x in songs}
PL={"pl1":{"id":"pl1","name":"Road Trip","owner":"demo","coverArt":"pl-1","duration":600,"ids":[x['id'] for x in songs[5:15]]},
    "pl2":{"id":"pl2","name":"Shared Mix","owner":"someone","readonly":True,"coverArt":"pl-2","duration":400,"ids":[x['id'] for x in songs[20:26]]}}
def lbtrack(t,a,mb='x'):
    return {"title":t,"creator":a,"album":"Some Album","identifier":["https://musicbrainz.org/recording/"+mb],
            "extension":{"https://musicbrainz.org/doc/jspf#track":{"additional_metadata":{"caa_id":1,"caa_release_mbid":"r"}}}}
def lb(s,u):
    p=u.path[6:]; log.append('LB '+p)
    if p=='validate-token':
        tok=s.headers.get('Authorization','')
        return s.send_json({"code":200,"valid":tok=='Token good',"user_name":"modren12" if tok=='Token good' else None,"message":"x"})
    if p.endswith('/playlists/createdfor'):
        def pl(mb,title,date,patch): return {"playlist":{"identifier":"https://listenbrainz.org/playlist/"+mb,"title":title,"date":date,
            "extension":{"https://musicbrainz.org/doc/jspf#playlist":{"additional_metadata":{"algorithm_metadata":{"source_patch":patch}}}}}}
        return s.send_json({"playlists":[pl("wj2","Weekly Jams for modren12, week of 2026-10-06 Mon","2026-10-06T00:00:00","weekly-jams"),
            pl("wj1","Weekly Jams for modren12, week of 2026-09-29 Mon","2026-09-29T00:00:00","weekly-jams"),
            pl("we1","Weekly Exploration for modren12, week of 2026-10-06 Mon","2026-10-06T00:00:01","weekly-exploration"),
            pl("dj1","Daily Jams for modren12, 2026-10-12 Mon","2026-10-12T00:00:00","daily-jams")],"count":4})
    if p.startswith('playlist/'):
        tr=[lbtrack(x['title'],x['artist'],x['id']) for x in songs[::5][:12]]+[lbtrack("Song Not Owned %d"%i,"Unknown Band %d"%i) for i in range(5)]
        return s.send_json({"playlist":{"title":"Weekly Jams for modren12, week of 2026-10-06 Mon","annotation":"<p>Songs you love, plus a few <b>new</b> ones.</p>","track":tr}})
    if p.endswith('/artists'):
        return s.send_json({"payload":{"total_artist_count":9,"artists":[{"artist_name":a[1],"listen_count":10} for a in artists]+[{"artist_name":"Not Here","listen_count":3}]}})
    if p.endswith('/releases'):
        return s.send_json({"payload":{"from_ts":1791763200,"to_ts":1792368000,"total_release_count":14,"releases":[
            {"release_name":"Not In Library","artist_name":"Somebody","listen_count":30},
            {"release_name":"Saudade (Remastered)","artist_name":"Marta Fado","listen_count":23},
            {"release_name":"Neon Rivers","artist_name":"Kilo Echo","listen_count":8}]}})
    if p.endswith('/listening-activity'):
        return s.send_json({"payload":{"from_ts":1791763200,"to_ts":1792368000,"listening_activity":
            [{"from_ts":1791158400+d*86400,"listen_count":5} for d in range(7)]+[{"from_ts":1791763200+d*86400,"listen_count":30+d} for d in range(7)]}})
    if p.endswith('/recordings'):
        return s.send_json({"payload":{"recordings":[{"track_name":x['title'],"artist_name":x['artist'],"listen_count":5} for x in songs[1::7][:12]]}})
    if p=='explore/lb-radio':
        if s.headers.get('Authorization')!='Token good': s.send_response(401); s.end_headers(); return
        tr=[lbtrack(x['title'],x['artist']) for x in songs[2::3][:20]]
        return s.send_json({"payload":{"jspf":{"playlist":{"track":tr}},"feedback":[]}})
    s.send_response(404); s.end_headers()
H.lb=lb
# Listening history for the time machine: 2024-01-01 .. yesterday, a few plays a day (Sal & Pimenta only from 2025).
import datetime as _dt
SCAN={'until':0,'n':0}
LISTENS=[]
_r=random.Random(7); _d=_dt.datetime(2024,1,1,12); _end=_dt.datetime.now()-_dt.timedelta(days=1)
while _d<_end:
    for k in range(_r.randint(0,5)):
        x=_r.choice(songs[:40]+songs[:16])
        if x['artist']=='Sal & Pimenta' and _d.year<2025: continue
        LISTENS.append({"listened_at":int((_d+_dt.timedelta(minutes=17*k)).timestamp()),"track_metadata":{"artist_name":x['artist'],"track_name":x['title'],"release_name":x['album'],"additional_info":{"duration_ms":x['duration']*1000*4}}})
    if _d.month==10 and _d.day==13 and _d.year==2025:
        for k in range(6): x=albums[2]['songs'][k]; LISTENS.append({"listened_at":int((_d+_dt.timedelta(hours=2,minutes=5*k)).timestamp()),"track_metadata":{"artist_name":x['artist'],"track_name":x['title'],"release_name":x['album']}})
    _d+=_dt.timedelta(days=1)
_d=_dt.datetime.now().replace(hour=20,minute=0,second=0,microsecond=0)-_dt.timedelta(days=90)
while _d<_end:      # evenings: a different crowd from the noon listens
    for k in range(3):
        x=songs[16+(_d.toordinal()*3+k*7)%24]
        LISTENS.append({"listened_at":int((_d+_dt.timedelta(minutes=9*k)).timestamp()),"track_metadata":{"artist_name":x['artist'],"track_name":x['title'],"release_name":x['album']}})
    _d+=_dt.timedelta(days=1)
LISTENS.sort(key=lambda l:-l['listened_at'])
_lb=lb
def lb2(s,u):
    p=u.path[6:]; q={k:v[0] for k,v in parse_qs(u.query).items()}
    if p.endswith('/listens'):
        mx=int(q.get('max_ts','9999999999')); n=int(q.get('count','25'))
        page=[l for l in LISTENS if l['listened_at']<mx][:n]; log.append('LB listens '+str(mx))
        return s.send_json({"payload":{"count":len(page),"listens":page}})
    if p.endswith('/listening-activity') and q.get('range')=='all_time':
        ys={}
        for l in LISTENS: y=_dt.datetime.fromtimestamp(l['listened_at']).year; ys[y]=ys.get(y,0)+1
        return s.send_json({"payload":{"range":"all_time","listening_activity":[{"time_range":str(y),"listen_count":c,"from_ts":0,"to_ts":0} for y,c in sorted(ys.items())]}})
    if p.endswith('/fresh_releases'):
        today=_dt.date.today()
        def rel(name,artist,days,typ='Album',rg=None): return {"release_name":name,"artist_credit_name":artist,"release_date":str(today+_dt.timedelta(days=days)),
            "release_group_mbid":rg or ('rg-'+name.lower().replace(' ','-')),"release_mbid":'rel-'+name.lower().replace(' ','-'),"release_group_primary_type":typ,"caa_id":None,"caa_release_mbid":None,"confidence":1}
        return s.send_json({"payload":{"releases":[rel("Saudade","Marta Fado",-5),rel("Fado Novo","Marta Fado",-12),rel("Glass Harbor II","Sal & Pimenta",-30,"EP"),
            rel("Lua Cheia","Lua Azul",21),rel("Northern Nights","The Northern Lights",-60)],"user_id":"modren12"}})
    return _lb(s,u)
H.lb=lb2
def mb(s,u):
    p=u.path[4:]; q={k:v[0] for k,v in parse_qs(u.query).items()}; log.append('MB '+p+' '+u.query)
    if p=='artist':
        name=q['query'].split('"')[1]
        return s.send_json({"artists":[{"id":"mb-"+a[0],"name":a[1],"score":100} for a in artists if a[1]==name]})
    if p=='release-group':
        aid=q['artist'][3:]; own=[a for a in albums if a['artistId']==aid]
        rgs=[{"id":"rg-"+a['id'],"title":a['name']+(" (Deluxe Edition)" if i==0 else ""),"primary-type":"Album","secondary-types":[],"first-release-date":str(a['year'])} for i,a in enumerate(own)]
        rgs+=[{"id":"rg-miss1-"+aid,"title":"Fado Novo" if aid=='ar3' else "Lost Tapes","primary-type":"Album","secondary-types":[],"first-release-date":"2001-05-04"},
              {"id":"rg-miss2-"+aid,"title":"Small Hours","primary-type":"EP","secondary-types":[],"first-release-date":"2015"},
              {"id":"rg-live-"+aid,"title":"Live at the Coliseu","primary-type":"Album","secondary-types":["Live"],"first-release-date":"2010"},
              {"id":"rg-future-"+aid,"title":"Next Year","primary-type":"Album","secondary-types":[],"first-release-date":"2099-01-01"}]
        return s.send_json({"release-group-count":len(rgs),"release-groups":rgs})
    s.send_response(404); s.end_headers()
H.mb=mb
# Ratings sync: ListenBrainz lookup + feedback, MusicBrainz OAuth + rating. Everything sent is kept for the tests (/__sent).
SENT=[]
_lb3=H.lb
def lb3(s,u):
    if u.path.endswith('/metadata/lookup/'):
        q={k:v[0] for k,v in parse_qs(u.query).items()}
        if 'Missing' in q.get('recording_name',''): return s.send_json({})
        return s.send_json({"recording_mbid":"rec-"+q.get('recording_name','').lower().replace(' ','-'),"artist_credit_name":q.get('artist_name')})
    return _lb3(s,u)
H.lb=lb3
_get=H.do_GET
def do_GET(s):
    u=urlparse(s.path)
    if u.path=='/__sent': return s.send_json(SENT)
    if u.path=='/mbo/userinfo': return s.send_json({"sub":"modren12mb"})
    return _get(s)
H.do_GET=do_GET
def do_POST(s):
    u=urlparse(s.path); body=s.rfile.read(int(s.headers.get('Content-Length') or 0)).decode()
    SENT.append({"path":u.path,"query":u.query,"auth":s.headers.get('Authorization',''),"body":body})
    if u.path=='/mbo/token': return s.send_json({"access_token":"mbtok","refresh_token":"mbref","expires_in":3600,"token_type":"Bearer"})
    if u.path in ('/lb/1/feedback/recording-feedback','/mb/rating'): return s.send_json({"status":"ok"})
    s.send_response(404); s.end_headers()
H.do_POST=do_POST
ThreadingHTTPServer(('127.0.0.1',8765),H).serve_forever()
