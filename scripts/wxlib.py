# -*- coding: utf-8 -*-
"""Helpers for reading a decrypted WeChat merged DB (PyWxDump `merge` output)."""
import sqlite3


def parse_pb(buf):
    """Minimal protobuf wire-format walker -> list of (field, wiretype, value)."""
    i, out, n = 0, [], len(buf)
    while i < n:
        key = buf[i]; i += 1
        field, wt = key >> 3, key & 7
        if wt == 0:  # varint
            v, s = 0, 0
            while True:
                b = buf[i]; i += 1; v |= (b & 0x7f) << s; s += 7
                if not b & 0x80:
                    break
            out.append((field, wt, v))
        elif wt == 2:  # length-delimited
            ln, s = 0, 0
            while True:
                b = buf[i]; i += 1; ln |= (b & 0x7f) << s; s += 7
                if not b & 0x80:
                    break
            out.append((field, wt, buf[i:i + ln])); i += ln
        elif wt == 5:
            out.append((field, wt, buf[i:i + 4])); i += 4
        elif wt == 1:
            out.append((field, wt, buf[i:i + 8])); i += 8
        else:
            break
    return out


def sender_from_bytes(bx):
    """Extract sender wxid from a chatroom message's BytesExtra blob."""
    if not bx:
        return None
    try:
        for f, wt, v in parse_pb(bx):
            if f == 3 and wt == 2 and isinstance(v, (bytes, bytearray)):
                typ = val = None
                for f2, wt2, v2 in parse_pb(v):
                    if f2 == 1 and wt2 == 0:
                        typ = v2
                    if f2 == 2 and wt2 == 2:
                        val = v2
                if typ == 1 and val:
                    return val.decode("utf-8", "ignore")
    except Exception:
        return None
    return None


def name_maps(conn):
    """wxid -> display name (remark > nickname > wxid)."""
    m = {}
    for un, nk, rm in conn.execute("SELECT UserName,NickName,Remark FROM Contact"):
        m[un] = rm or nk or un
    return m


def group_display_names(conn, chatroom):
    """wxid -> in-group display name (ChatRoom.UserNameList/DisplayNameList, '^G'-joined)."""
    r = conn.execute(
        "SELECT UserNameList,DisplayNameList FROM ChatRoom WHERE ChatRoomName=?",
        (chatroom,)).fetchone()
    d = {}
    if r and r[0]:
        us = (r[0] or "").split("^G")
        ds = (r[1] or "").split("^G")
        for i, u in enumerate(us):
            if i < len(ds) and ds[i]:
                d[u] = ds[i]
    return d
