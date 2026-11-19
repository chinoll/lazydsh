# Third-party source

`src/providers/gemini/` incorporates the GPL-3.0-only adapter from
[chinoll/dsh-gemini](https://github.com/chinoll/dsh-gemini), based on the locally
maintained 0.1.5 source. It is maintained in this repository as part of lazydsh.
Native replay metadata remains compatible; the standalone text source footer
is replaced by lazydsh's collapsible source display.

`vendor/ui-settings-models/src` contains the source distributed in
`@deepseek-ai/dsh-client-ui-settings-models@0.2.2-rc.3` by DeepSeek, whose package
metadata declares the MIT license. The upstream package metadata is preserved
in `vendor/ui-settings-models/upstream-package.json`. These files retain their
upstream MIT license; the adapter's original code is GPL-3.0-only.

The local changes recognize `llm-google-native` in the existing ProviderEditor,
add its Google Search checkbox using the existing primitive, and show fixed
Gemini input modalities as read-only. All other model editing components and
styles are reused from that release. The stock Models section is disabled by
the bundle patch while this compatible section is mounted, to keep one section
and one original Edit button. Removing the bundle restores the stock section.

`vendor/ui-chat-actions/` reuses the message action row, date helpers, and
adapted user-message renderer from `@deepseek-ai/dsh-client-ui-chat@0.2.2-rc.3`
(MIT). The adapted renderer preserves native content factories, attachments,
message clocks, adding inline version actions and editing.
Its upstream package metadata is included in that directory.

## MIT license

Copyright belongs to the upstream DeepSeek project contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
