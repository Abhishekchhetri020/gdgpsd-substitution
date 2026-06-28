#!/usr/bin/env python3
"""One-shot repair: Flat — Teacher / Flat — Class — Start & End columns.

The in-app XML uploader (Apps Script setValues) parsed times like "7:40" into
Date(1899-12-30, 7:40) values. Reading them back via JS String() then surfaced
"Sat Dec 30 1899 13:01:10 GMT+0521..." in the planner UI.

Fix: read cols D/E as UNFORMATTED_VALUE (gets the fraction-of-day serial),
convert back to "H:MM" text, write back with valueInputOption=RAW, and set
the column number format to plain text so future writes stay strings.
"""
import json
import urllib.parse
import urllib.request

from refresh_timetable import (
    SPREADSHEET_ID, get_access_token, sheets_put, sheets_batch_update,
)

TABS = ['Flat — Teacher', 'Flat — Class']


def fetch_unformatted(at: str, range_: str) -> list[list]:
    url = (f'https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/'
           f'{urllib.parse.quote(range_)}?majorDimension=ROWS'
           f'&valueRenderOption=UNFORMATTED_VALUE')
    r = urllib.request.urlopen(urllib.request.Request(
        url, headers={'Authorization': f'Bearer {at}'}))
    return json.loads(r.read()).get('values', [])


def get_sheet_id(at: str, title: str) -> int:
    url = (f'https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}'
           f'?fields=sheets(properties(sheetId,title))')
    r = urllib.request.urlopen(urllib.request.Request(
        url, headers={'Authorization': f'Bearer {at}'}))
    for sh in json.loads(r.read())['sheets']:
        if sh['properties']['title'] == title:
            return sh['properties']['sheetId']
    raise KeyError(title)


def serial_to_hhmm(v):
    """Convert a fraction-of-day serial (0 ≤ v < 2) to 'H:MM'. Pass through strings."""
    if isinstance(v, (int, float)):
        # Sheets stores time-of-day as fraction. Anything ≥ 1 includes the date part.
        minutes = round((float(v) % 1) * 24 * 60)
        return f'{minutes // 60}:{minutes % 60:02d}'
    return v


def main():
    at = get_access_token()
    for tab in TABS:
        rng = f"'{tab}'!D2:E"
        rows = fetch_unformatted(at, rng)
        if not rows:
            print(f'{tab}: empty')
            continue
        fixed = [[serial_to_hhmm(c) for c in (r + ['', ''])[:2]] for r in rows]
        sample = next((r for r in fixed if r[0]), None)
        print(f'{tab}: {len(fixed)} rows · sample={sample}')

        sid = get_sheet_id(at, tab)
        sheets_batch_update(at, [{
            'repeatCell': {
                'range': {'sheetId': sid, 'startColumnIndex': 3, 'endColumnIndex': 5},
                'cell': {'userEnteredFormat': {'numberFormat': {'type': 'TEXT'}}},
                'fields': 'userEnteredFormat.numberFormat',
            }
        }])
        sheets_put(at, rng, fixed)
    print('done')


if __name__ == '__main__':
    main()
