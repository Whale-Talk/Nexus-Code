import { expect, test } from 'bun:test'
import { Cursor } from './Cursor.js'

const identity = (text: string) => text

test.each(['short', 'key-that-wraps-across-several-lines'])(
  'fully masks secret input (%s)',
  secret => {
    const cursor = Cursor.fromText(secret, 12, secret.length)
    const rendered = cursor.render('', '*', identity, undefined, undefined, false)
    expect(rendered.replaceAll('\n', '')).toBe('*'.repeat(secret.length))
  },
)
