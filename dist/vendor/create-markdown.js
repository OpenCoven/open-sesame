/*! @create-markdown/core + preview 2.0.3 | MIT | pinned source c5c291c9801078674069fd30eea8203777e6f7d8 */
(()=>{const factories={"packages/core/src/index.ts":function(__exports,__require){
__exports.generateId=__require("packages/core/src/core/utils.ts").generateId;
__exports.deepClone=__require("packages/core/src/core/utils.ts").deepClone;
__exports.deepCloneBlocks=__require("packages/core/src/core/utils.ts").deepCloneBlocks;
__exports.normalizeLineEndings=__require("packages/core/src/core/utils.ts").normalizeLineEndings;
__exports.convertLineEndings=__require("packages/core/src/core/utils.ts").convertLineEndings;
__exports.escapeMarkdown=__require("packages/core/src/core/utils.ts").escapeMarkdown;
__exports.unescapeMarkdown=__require("packages/core/src/core/utils.ts").unescapeMarkdown;
__exports.escapeCodeBlock=__require("packages/core/src/core/utils.ts").escapeCodeBlock;
__exports.trimTrailingWhitespace=__require("packages/core/src/core/utils.ts").trimTrailingWhitespace;
__exports.trimBlankLines=__require("packages/core/src/core/utils.ts").trimBlankLines;
__exports.indent=__require("packages/core/src/core/utils.ts").indent;
__exports.spansToPlainText=__require("packages/core/src/core/utils.ts").spansToPlainText;
__exports.plainSpan=__require("packages/core/src/core/utils.ts").plainSpan;
__exports.plainContent=__require("packages/core/src/core/utils.ts").plainContent;
__exports.hasContent=__require("packages/core/src/core/utils.ts").hasContent;
__exports.hasChildren=__require("packages/core/src/core/utils.ts").hasChildren;
__exports.isValidHeadingLevel=__require("packages/core/src/core/utils.ts").isValidHeadingLevel;
__exports.isValidBlockType=__require("packages/core/src/core/utils.ts").isValidBlockType;
__exports.createBlock=__require("packages/core/src/core/blocks.ts").createBlock;
__exports.text=__require("packages/core/src/core/blocks.ts").text;
__exports.bold=__require("packages/core/src/core/blocks.ts").bold;
__exports.italic=__require("packages/core/src/core/blocks.ts").italic;
__exports.code=__require("packages/core/src/core/blocks.ts").code;
__exports.strikethrough=__require("packages/core/src/core/blocks.ts").strikethrough;
__exports.underline=__require("packages/core/src/core/blocks.ts").underline;
__exports.highlight=__require("packages/core/src/core/blocks.ts").highlight;
__exports.link=__require("packages/core/src/core/blocks.ts").link;
__exports.styled=__require("packages/core/src/core/blocks.ts").styled;
__exports.spans=__require("packages/core/src/core/blocks.ts").spans;
__exports.paragraph=__require("packages/core/src/core/blocks.ts").paragraph;
__exports.heading=__require("packages/core/src/core/blocks.ts").heading;
__exports.h1=__require("packages/core/src/core/blocks.ts").h1;
__exports.h2=__require("packages/core/src/core/blocks.ts").h2;
__exports.h3=__require("packages/core/src/core/blocks.ts").h3;
__exports.h4=__require("packages/core/src/core/blocks.ts").h4;
__exports.h5=__require("packages/core/src/core/blocks.ts").h5;
__exports.h6=__require("packages/core/src/core/blocks.ts").h6;
__exports.bulletList=__require("packages/core/src/core/blocks.ts").bulletList;
__exports.numberedList=__require("packages/core/src/core/blocks.ts").numberedList;
__exports.checkListItem=__require("packages/core/src/core/blocks.ts").checkListItem;
__exports.checkList=__require("packages/core/src/core/blocks.ts").checkList;
__exports.codeBlock=__require("packages/core/src/core/blocks.ts").codeBlock;
__exports.blockquote=__require("packages/core/src/core/blocks.ts").blockquote;
__exports.divider=__require("packages/core/src/core/blocks.ts").divider;
__exports.image=__require("packages/core/src/core/blocks.ts").image;
__exports.callout=__require("packages/core/src/core/blocks.ts").callout;
__exports.infoCallout=__require("packages/core/src/core/blocks.ts").infoCallout;
__exports.warningCallout=__require("packages/core/src/core/blocks.ts").warningCallout;
__exports.tipCallout=__require("packages/core/src/core/blocks.ts").tipCallout;
__exports.dangerCallout=__require("packages/core/src/core/blocks.ts").dangerCallout;
__exports.noteCallout=__require("packages/core/src/core/blocks.ts").noteCallout;
__exports.table=__require("packages/core/src/core/blocks.ts").table;
__exports.appendContent=__require("packages/core/src/core/blocks.ts").appendContent;
__exports.prependContent=__require("packages/core/src/core/blocks.ts").prependContent;
__exports.setContent=__require("packages/core/src/core/blocks.ts").setContent;
__exports.addChildren=__require("packages/core/src/core/blocks.ts").addChildren;
__exports.updateProps=__require("packages/core/src/core/blocks.ts").updateProps;
__exports.DOCUMENT_VERSION=__require("packages/core/src/core/document.ts").DOCUMENT_VERSION;
__exports.createDocument=__require("packages/core/src/core/document.ts").createDocument;
__exports.emptyDocument=__require("packages/core/src/core/document.ts").emptyDocument;
__exports.cloneDocument=__require("packages/core/src/core/document.ts").cloneDocument;
__exports.insertBlock=__require("packages/core/src/core/document.ts").insertBlock;
__exports.appendBlock=__require("packages/core/src/core/document.ts").appendBlock;
__exports.prependBlock=__require("packages/core/src/core/document.ts").prependBlock;
__exports.insertBlocks=__require("packages/core/src/core/document.ts").insertBlocks;
__exports.removeBlock=__require("packages/core/src/core/document.ts").removeBlock;
__exports.removeBlocks=__require("packages/core/src/core/document.ts").removeBlocks;
__exports.updateBlock=__require("packages/core/src/core/document.ts").updateBlock;
__exports.replaceBlock=__require("packages/core/src/core/document.ts").replaceBlock;
__exports.moveBlock=__require("packages/core/src/core/document.ts").moveBlock;
__exports.swapBlocks=__require("packages/core/src/core/document.ts").swapBlocks;
__exports.findBlock=__require("packages/core/src/core/document.ts").findBlock;
__exports.getBlockIndex=__require("packages/core/src/core/document.ts").getBlockIndex;
__exports.getBlockAt=__require("packages/core/src/core/document.ts").getBlockAt;
__exports.getFirstBlock=__require("packages/core/src/core/document.ts").getFirstBlock;
__exports.getLastBlock=__require("packages/core/src/core/document.ts").getLastBlock;
__exports.findBlocksByType=__require("packages/core/src/core/document.ts").findBlocksByType;
__exports.hasBlock=__require("packages/core/src/core/document.ts").hasBlock;
__exports.getBlockCount=__require("packages/core/src/core/document.ts").getBlockCount;
__exports.isEmpty=__require("packages/core/src/core/document.ts").isEmpty;
__exports.setBlockContent=__require("packages/core/src/core/document.ts").setBlockContent;
__exports.appendBlockContent=__require("packages/core/src/core/document.ts").appendBlockContent;
__exports.updateMeta=__require("packages/core/src/core/document.ts").updateMeta;
__exports.setMetaField=__require("packages/core/src/core/document.ts").setMetaField;
__exports.getMetaField=__require("packages/core/src/core/document.ts").getMetaField;
__exports.clearBlocks=__require("packages/core/src/core/document.ts").clearBlocks;
__exports.setBlocks=__require("packages/core/src/core/document.ts").setBlocks;
__exports.filterBlocks=__require("packages/core/src/core/document.ts").filterBlocks;
__exports.mapBlocks=__require("packages/core/src/core/document.ts").mapBlocks;
__exports.blocksToMarkdown=__require("packages/core/src/serializers/markdown.ts").blocksToMarkdown;
__exports.documentToMarkdown=__require("packages/core/src/serializers/markdown.ts").documentToMarkdown;
__exports.serializeBlock=__require("packages/core/src/serializers/markdown.ts").serializeBlock;
__exports.serializeInlineContent=__require("packages/core/src/serializers/markdown.ts").serializeInlineContent;
__exports.serializeSpan=__require("packages/core/src/serializers/markdown.ts").serializeSpan;
__exports.stringify=__require("packages/core/src/serializers/markdown.ts").stringify;
__exports.markdownToBlocks=__require("packages/core/src/parsers/markdown.ts").markdownToBlocks;
__exports.markdownToDocument=__require("packages/core/src/parsers/markdown.ts").markdownToDocument;
__exports.parse=__require("packages/core/src/parsers/markdown.ts").parse;
__exports.parseInlineContent=__require("packages/core/src/parsers/markdown.ts").parseInlineContent;
__exports.tokenize=__require("packages/core/src/parsers/tokenizer.ts").tokenize;
__exports.groupTokens=__require("packages/core/src/parsers/tokenizer.ts").groupTokens;
__exports.isListToken=__require("packages/core/src/parsers/tokenizer.ts").isListToken;
__exports.isCodeToken=__require("packages/core/src/parsers/tokenizer.ts").isCodeToken;
const {markdownToBlocks}=__require("packages/core/src/parsers/markdown.ts");
const {blocksToMarkdown}=__require("packages/core/src/serializers/markdown.ts");
const {createDocument:createDoc}=__require("packages/core/src/core/document.ts");
function fromMarkdown(markdown) {
    const blocks = markdownToBlocks(markdown);
    return createDoc(blocks);
}
function toMarkdown(blocksOrDoc) {
    const blocks = Array.isArray(blocksOrDoc) ? blocksOrDoc : blocksOrDoc.blocks;
    return blocksToMarkdown(blocks);
}
const VERSION = '2.0.3';


//# sourceURL=packages/core/src/index.ts
__exports.fromMarkdown=fromMarkdown;
__exports.toMarkdown=toMarkdown;
__exports.VERSION=VERSION;
},
"packages/core/src/parsers/markdown.ts":function(__exports,__require){
const {generateId,plainContent}=__require("packages/core/src/core/utils.ts");
const {createDocument}=__require("packages/core/src/core/document.ts");
const {tokenize}=__require("packages/core/src/parsers/tokenizer.ts");
const {parseInlineContent}=__require("packages/core/src/parsers/inline.ts");
const DEFAULT_OPTIONS = {
    generateId,
    strict: false
};
function markdownToBlocks(markdown, options = {}) {
    const opts = {
        ...DEFAULT_OPTIONS,
        ...options
    };
    const tokens = tokenize(markdown);
    return parseTokens(tokens, opts);
}
function markdownToDocument(markdown, options = {}) {
    const blocks = markdownToBlocks(markdown, options);
    return createDocument(blocks);
}
function parse(markdown, options) {
    return markdownToBlocks(markdown, options);
}
function parseTokens(tokens, options) {
    const blocks = [];
    const state = {
        options,
        tokens,
        index: 0
    };
    while(state.index < tokens.length){
        const token = tokens[state.index];
        if (token.type === 'blank') {
            state.index++;
            continue;
        }
        const block = parseBlock(state);
        if (block) {
            blocks.push(block);
        }
    }
    return blocks;
}
function parseBlock(state) {
    const token = state.tokens[state.index];
    switch(token.type){
        case 'heading':
            return parseHeading(state);
        case 'paragraph':
            return parseParagraph(state);
        case 'bullet_list_item':
            return parseBulletList(state);
        case 'numbered_list_item':
            return parseNumberedList(state);
        case 'check_list_item':
            return parseCheckListItem(state);
        case 'code_fence_start':
            return parseCodeBlock(state);
        case 'blockquote':
            return parseBlockquote(state);
        case 'callout':
            return parseCallout(state);
        case 'divider':
            return parseDivider(state);
        case 'table_row':
            return parseTable(state);
        case 'image':
            return parseImage(state);
        default:
            state.index++;
            return null;
    }
}
function parseHeading(state) {
    const token = state.tokens[state.index];
    const level = token.meta?.level ?? 1;
    const content = parseInlineContent(token.content);
    state.index++;
    return {
        id: state.options.generateId(),
        type: 'heading',
        content,
        children: [],
        props: {
            level
        }
    };
}
function parseParagraph(state) {
    const lines = [];
    while(state.index < state.tokens.length && state.tokens[state.index].type === 'paragraph'){
        lines.push(state.tokens[state.index].content);
        state.index++;
    }
    const content = parseInlineContent(lines.join(' '));
    return {
        id: state.options.generateId(),
        type: 'paragraph',
        content,
        children: [],
        props: {}
    };
}
function parseBulletList(state) {
    const children = [];
    const baseIndent = state.tokens[state.index].indent;
    while(state.index < state.tokens.length && state.tokens[state.index].type === 'bullet_list_item' && state.tokens[state.index].indent >= baseIndent){
        const token = state.tokens[state.index];
        if (token.indent > baseIndent) {
            state.index++;
            continue;
        }
        const content = parseInlineContent(token.content);
        children.push({
            id: state.options.generateId(),
            type: 'paragraph',
            content,
            children: [],
            props: {}
        });
        state.index++;
    }
    return {
        id: state.options.generateId(),
        type: 'bulletList',
        content: [],
        children,
        props: {}
    };
}
function parseNumberedList(state) {
    const children = [];
    const baseIndent = state.tokens[state.index].indent;
    while(state.index < state.tokens.length && state.tokens[state.index].type === 'numbered_list_item' && state.tokens[state.index].indent >= baseIndent){
        const token = state.tokens[state.index];
        if (token.indent > baseIndent) {
            state.index++;
            continue;
        }
        const content = parseInlineContent(token.content);
        children.push({
            id: state.options.generateId(),
            type: 'paragraph',
            content,
            children: [],
            props: {}
        });
        state.index++;
    }
    return {
        id: state.options.generateId(),
        type: 'numberedList',
        content: [],
        children,
        props: {}
    };
}
function parseCheckListItem(state) {
    const token = state.tokens[state.index];
    const checked = token.meta?.checked ?? false;
    const content = parseInlineContent(token.content);
    state.index++;
    return {
        id: state.options.generateId(),
        type: 'checkList',
        content,
        children: [],
        props: {
            checked
        }
    };
}
function parseCodeBlock(state) {
    const startToken = state.tokens[state.index];
    const language = startToken.meta?.language ?? '';
    const codeLines = [];
    state.index++;
    while(state.index < state.tokens.length && state.tokens[state.index].type === 'code_content'){
        codeLines.push(state.tokens[state.index].content);
        state.index++;
    }
    if (state.index < state.tokens.length && state.tokens[state.index].type === 'code_fence_end') {
        state.index++;
    }
    return {
        id: state.options.generateId(),
        type: 'codeBlock',
        content: plainContent(codeLines.join('\n')),
        children: [],
        props: {
            language: language || undefined
        }
    };
}
function parseBlockquote(state) {
    const lines = [];
    while(state.index < state.tokens.length && state.tokens[state.index].type === 'blockquote'){
        lines.push(state.tokens[state.index].content);
        state.index++;
    }
    const content = parseInlineContent(lines.join('\n'));
    return {
        id: state.options.generateId(),
        type: 'blockquote',
        content,
        children: [],
        props: {}
    };
}
function parseCallout(state) {
    const calloutToken = state.tokens[state.index];
    const calloutType = calloutToken.meta?.calloutType ?? 'note';
    state.index++;
    const lines = [];
    while(state.index < state.tokens.length && state.tokens[state.index].type === 'blockquote'){
        lines.push(state.tokens[state.index].content);
        state.index++;
    }
    const content = parseInlineContent(lines.join('\n'));
    return {
        id: state.options.generateId(),
        type: 'callout',
        content,
        children: [],
        props: {
            type: calloutType
        }
    };
}
function parseDivider(state) {
    state.index++;
    return {
        id: state.options.generateId(),
        type: 'divider',
        content: [],
        children: [],
        props: {}
    };
}
function parseTable(state) {
    const rows = [];
    let headers = [];
    let alignments = [];
    let isFirstRow = true;
    let hasSeparator = false;
    while(state.index < state.tokens.length && (state.tokens[state.index].type === 'table_row' || state.tokens[state.index].type === 'table_separator')){
        const token = state.tokens[state.index];
        if (token.type === 'table_separator') {
            alignments = parseTableAlignments(token.content);
            hasSeparator = true;
            state.index++;
            continue;
        }
        const cells = token.content.split('|').map((cell)=>cell.trim()).filter((cell)=>cell !== '');
        if (isFirstRow && !hasSeparator) {
            headers = cells;
            isFirstRow = false;
        } else if (hasSeparator) {
            rows.push(cells);
        }
        state.index++;
    }
    if (!hasSeparator && headers.length > 0) {
        rows.unshift(headers);
        headers = [];
    }
    return {
        id: state.options.generateId(),
        type: 'table',
        content: [],
        children: [],
        props: {
            headers,
            rows,
            alignments: alignments.length > 0 ? alignments : undefined
        }
    };
}
function parseTableAlignments(separator) {
    return separator.split('|').map((cell)=>cell.trim()).filter((cell)=>cell !== '').map((cell)=>{
        const leftColon = cell.startsWith(':');
        const rightColon = cell.endsWith(':');
        if (leftColon && rightColon) return 'center';
        if (leftColon) return 'left';
        if (rightColon) return 'right';
        return null;
    });
}
function parseImage(state) {
    const token = state.tokens[state.index];
    const url = token.content;
    const alt = token.meta?.language ?? '';
    state.index++;
    return {
        id: state.options.generateId(),
        type: 'image',
        content: [],
        children: [],
        props: {
            url,
            alt: alt || undefined
        }
    };
}
__exports.parseInlineContent=__require("packages/core/src/parsers/inline.ts").parseInlineContent;


//# sourceURL=packages/core/src/parsers/markdown.ts
__exports.markdownToBlocks=markdownToBlocks;
__exports.markdownToDocument=markdownToDocument;
__exports.parse=parse;
},
"packages/core/src/core/utils.ts":function(__exports,__require){
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 8;
function generateId(length = ID_LENGTH) {
    let id = '';
    const charsLength = ID_CHARS.length;
    for(let i = 0; i < length; i++){
        id += ID_CHARS.charAt(Math.floor(Math.random() * charsLength));
    }
    return id;
}
function deepClone(block, regenerateIds = true) {
    return {
        id: regenerateIds ? generateId() : block.id,
        type: block.type,
        content: block.content.map((span)=>({
                text: span.text,
                styles: {
                    ...span.styles
                }
            })),
        children: block.children.map((child)=>deepClone(child, regenerateIds)),
        props: {
            ...block.props
        }
    };
}
function deepCloneBlocks(blocks, regenerateIds = true) {
    return blocks.map((block)=>deepClone(block, regenerateIds));
}
function normalizeLineEndings(text) {
    return text.replace(/\r\n|\r/g, '\n');
}
function convertLineEndings(text, lineEnding) {
    const normalized = normalizeLineEndings(text);
    if (lineEnding === '\r\n') {
        return normalized.replace(/\n/g, '\r\n');
    }
    return normalized;
}
const MARKDOWN_ESCAPE_CHARS = /[\\`*_{}[\]()#+\-.!|]/g;
function escapeMarkdown(text) {
    return text.replace(MARKDOWN_ESCAPE_CHARS, '\\$&');
}
function unescapeMarkdown(text) {
    return text.replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1');
}
function escapeCodeBlock(text) {
    return text.replace(/```/g, '\\`\\`\\`');
}
function trimTrailingWhitespace(text) {
    return text.split('\n').map((line)=>line.trimEnd()).join('\n');
}
function trimBlankLines(text) {
    const lines = text.split('\n');
    let start = 0;
    while(start < lines.length && lines[start].trim() === ''){
        start++;
    }
    let end = lines.length - 1;
    while(end >= start && lines[end].trim() === ''){
        end--;
    }
    return lines.slice(start, end + 1).join('\n');
}
function indent(text, spaces) {
    const padding = ' '.repeat(spaces);
    return text.split('\n').map((line)=>line.trim() ? padding + line : line).join('\n');
}
function spansToPlainText(spans) {
    return spans.map((span)=>span.text).join('');
}
function plainSpan(text) {
    return {
        text,
        styles: {}
    };
}
function plainContent(text) {
    return [
        plainSpan(text)
    ];
}
function hasContent(block) {
    return block.content.length > 0 && block.content.some((span)=>span.text.length > 0);
}
function hasChildren(block) {
    return block.children.length > 0;
}
function isValidHeadingLevel(level) {
    return Number.isInteger(level) && level >= 1 && level <= 6;
}
function isValidBlockType(type) {
    const validTypes = [
        'paragraph',
        'heading',
        'bulletList',
        'numberedList',
        'checkList',
        'codeBlock',
        'blockquote',
        'table',
        'image',
        'divider',
        'callout'
    ];
    return validTypes.includes(type);
}


//# sourceURL=packages/core/src/core/utils.ts
__exports.generateId=generateId;
__exports.deepClone=deepClone;
__exports.deepCloneBlocks=deepCloneBlocks;
__exports.normalizeLineEndings=normalizeLineEndings;
__exports.convertLineEndings=convertLineEndings;
__exports.escapeMarkdown=escapeMarkdown;
__exports.unescapeMarkdown=unescapeMarkdown;
__exports.escapeCodeBlock=escapeCodeBlock;
__exports.trimTrailingWhitespace=trimTrailingWhitespace;
__exports.trimBlankLines=trimBlankLines;
__exports.indent=indent;
__exports.spansToPlainText=spansToPlainText;
__exports.plainSpan=plainSpan;
__exports.plainContent=plainContent;
__exports.hasContent=hasContent;
__exports.hasChildren=hasChildren;
__exports.isValidHeadingLevel=isValidHeadingLevel;
__exports.isValidBlockType=isValidBlockType;
},
"packages/core/src/core/document.ts":function(__exports,__require){
const {deepClone,deepCloneBlocks}=__require("packages/core/src/core/utils.ts");
const DOCUMENT_VERSION = 1;
function createDocument(blocks = [], options = {}) {
    const { meta = {} } = options;
    return {
        version: DOCUMENT_VERSION,
        blocks: deepCloneBlocks(blocks, false),
        meta: {
            createdAt: new Date(),
            updatedAt: new Date(),
            ...meta
        }
    };
}
function emptyDocument(options = {}) {
    return createDocument([], options);
}
function cloneDocument(doc) {
    return {
        version: doc.version,
        blocks: deepCloneBlocks(doc.blocks, true),
        meta: {
            ...doc.meta,
            createdAt: new Date(),
            updatedAt: new Date()
        }
    };
}
function insertBlock(doc, block, index) {
    const newBlocks = [
        ...doc.blocks
    ];
    const insertIndex = index ?? newBlocks.length;
    newBlocks.splice(insertIndex, 0, deepClone(block, false));
    return {
        ...doc,
        blocks: newBlocks,
        meta: {
            ...doc.meta,
            updatedAt: new Date()
        }
    };
}
function appendBlock(doc, block) {
    return insertBlock(doc, block);
}
function prependBlock(doc, block) {
    return insertBlock(doc, block, 0);
}
function insertBlocks(doc, blocks, index) {
    const newBlocks = [
        ...doc.blocks
    ];
    const insertIndex = index ?? newBlocks.length;
    newBlocks.splice(insertIndex, 0, ...deepCloneBlocks(blocks, false));
    return {
        ...doc,
        blocks: newBlocks,
        meta: {
            ...doc.meta,
            updatedAt: new Date()
        }
    };
}
function removeBlock(doc, blockId) {
    const newBlocks = doc.blocks.filter((block)=>block.id !== blockId);
    if (newBlocks.length === doc.blocks.length) {
        return doc;
    }
    return {
        ...doc,
        blocks: newBlocks,
        meta: {
            ...doc.meta,
            updatedAt: new Date()
        }
    };
}
function removeBlocks(doc, blockIds) {
    const idSet = new Set(blockIds);
    const newBlocks = doc.blocks.filter((block)=>!idSet.has(block.id));
    if (newBlocks.length === doc.blocks.length) {
        return doc;
    }
    return {
        ...doc,
        blocks: newBlocks,
        meta: {
            ...doc.meta,
            updatedAt: new Date()
        }
    };
}
function updateBlock(doc, blockId, updates) {
    const blockIndex = doc.blocks.findIndex((block)=>block.id === blockId);
    if (blockIndex === -1) {
        return doc;
    }
    const newBlocks = [
        ...doc.blocks
    ];
    const existingBlock = newBlocks[blockIndex];
    newBlocks[blockIndex] = {
        ...existingBlock,
        ...updates,
        id: existingBlock.id,
        type: existingBlock.type,
        content: updates.content ?? existingBlock.content,
        children: updates.children ?? existingBlock.children,
        props: updates.props ? {
            ...existingBlock.props,
            ...updates.props
        } : existingBlock.props
    };
    return {
        ...doc,
        blocks: newBlocks,
        meta: {
            ...doc.meta,
            updatedAt: new Date()
        }
    };
}
function replaceBlock(doc, blockId, newBlock) {
    const blockIndex = doc.blocks.findIndex((block)=>block.id === blockId);
    if (blockIndex === -1) {
        return doc;
    }
    const newBlocks = [
        ...doc.blocks
    ];
    newBlocks[blockIndex] = deepClone(newBlock, false);
    return {
        ...doc,
        blocks: newBlocks,
        meta: {
            ...doc.meta,
            updatedAt: new Date()
        }
    };
}
function moveBlock(doc, blockId, newIndex) {
    const currentIndex = doc.blocks.findIndex((block)=>block.id === blockId);
    if (currentIndex === -1) {
        return doc;
    }
    const targetIndex = Math.max(0, Math.min(newIndex, doc.blocks.length - 1));
    if (currentIndex === targetIndex) {
        return doc;
    }
    const newBlocks = [
        ...doc.blocks
    ];
    const [movedBlock] = newBlocks.splice(currentIndex, 1);
    newBlocks.splice(targetIndex, 0, movedBlock);
    return {
        ...doc,
        blocks: newBlocks,
        meta: {
            ...doc.meta,
            updatedAt: new Date()
        }
    };
}
function swapBlocks(doc, blockId1, blockId2) {
    const index1 = doc.blocks.findIndex((block)=>block.id === blockId1);
    const index2 = doc.blocks.findIndex((block)=>block.id === blockId2);
    if (index1 === -1 || index2 === -1 || index1 === index2) {
        return doc;
    }
    const newBlocks = [
        ...doc.blocks
    ];
    [newBlocks[index1], newBlocks[index2]] = [
        newBlocks[index2],
        newBlocks[index1]
    ];
    return {
        ...doc,
        blocks: newBlocks,
        meta: {
            ...doc.meta,
            updatedAt: new Date()
        }
    };
}
function findBlock(doc, blockId) {
    return doc.blocks.find((block)=>block.id === blockId);
}
function getBlockIndex(doc, blockId) {
    return doc.blocks.findIndex((block)=>block.id === blockId);
}
function getBlockAt(doc, index) {
    return doc.blocks[index];
}
function getFirstBlock(doc) {
    return doc.blocks[0];
}
function getLastBlock(doc) {
    return doc.blocks[doc.blocks.length - 1];
}
function findBlocksByType(doc, type) {
    return doc.blocks.filter((block)=>block.type === type);
}
function hasBlock(doc, blockId) {
    return doc.blocks.some((block)=>block.id === blockId);
}
function getBlockCount(doc) {
    return doc.blocks.length;
}
function isEmpty(doc) {
    return doc.blocks.length === 0;
}
function setBlockContent(doc, blockId, content) {
    return updateBlock(doc, blockId, {
        content
    });
}
function appendBlockContent(doc, blockId, content) {
    const block = findBlock(doc, blockId);
    if (!block) return doc;
    return updateBlock(doc, blockId, {
        content: [
            ...block.content,
            ...content
        ]
    });
}
function updateMeta(doc, meta) {
    return {
        ...doc,
        meta: {
            ...doc.meta,
            ...meta,
            updatedAt: new Date()
        }
    };
}
function setMetaField(doc, key, value) {
    return updateMeta(doc, {
        [key]: value
    });
}
function getMetaField(doc, key) {
    return doc.meta[key];
}
function clearBlocks(doc) {
    return {
        ...doc,
        blocks: [],
        meta: {
            ...doc.meta,
            updatedAt: new Date()
        }
    };
}
function setBlocks(doc, blocks) {
    return {
        ...doc,
        blocks: deepCloneBlocks(blocks, false),
        meta: {
            ...doc.meta,
            updatedAt: new Date()
        }
    };
}
function filterBlocks(doc, predicate) {
    const newBlocks = doc.blocks.filter(predicate);
    if (newBlocks.length === doc.blocks.length) {
        return doc;
    }
    return {
        ...doc,
        blocks: newBlocks,
        meta: {
            ...doc.meta,
            updatedAt: new Date()
        }
    };
}
function mapBlocks(doc, transform) {
    return {
        ...doc,
        blocks: doc.blocks.map(transform),
        meta: {
            ...doc.meta,
            updatedAt: new Date()
        }
    };
}


//# sourceURL=packages/core/src/core/document.ts
__exports.DOCUMENT_VERSION=DOCUMENT_VERSION;
__exports.createDocument=createDocument;
__exports.emptyDocument=emptyDocument;
__exports.cloneDocument=cloneDocument;
__exports.insertBlock=insertBlock;
__exports.appendBlock=appendBlock;
__exports.prependBlock=prependBlock;
__exports.insertBlocks=insertBlocks;
__exports.removeBlock=removeBlock;
__exports.removeBlocks=removeBlocks;
__exports.updateBlock=updateBlock;
__exports.replaceBlock=replaceBlock;
__exports.moveBlock=moveBlock;
__exports.swapBlocks=swapBlocks;
__exports.findBlock=findBlock;
__exports.getBlockIndex=getBlockIndex;
__exports.getBlockAt=getBlockAt;
__exports.getFirstBlock=getFirstBlock;
__exports.getLastBlock=getLastBlock;
__exports.findBlocksByType=findBlocksByType;
__exports.hasBlock=hasBlock;
__exports.getBlockCount=getBlockCount;
__exports.isEmpty=isEmpty;
__exports.setBlockContent=setBlockContent;
__exports.appendBlockContent=appendBlockContent;
__exports.updateMeta=updateMeta;
__exports.setMetaField=setMetaField;
__exports.getMetaField=getMetaField;
__exports.clearBlocks=clearBlocks;
__exports.setBlocks=setBlocks;
__exports.filterBlocks=filterBlocks;
__exports.mapBlocks=mapBlocks;
},
"packages/core/src/parsers/tokenizer.ts":function(__exports,__require){
const PATTERNS = {
    heading: /^(#{1,6})\s+(.*)$/,
    setextH1: /^=+\s*$/,
    setextH2: /^-+\s*$/,
    bulletList: /^(\s*)([-*+])\s+(.*)$/,
    numberedList: /^(\s*)(\d+)\.\s+(.*)$/,
    checkList: /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/,
    codeFence: /^(\s*)(`{3,}|~{3,})(\w*)?\s*$/,
    blockquote: /^>\s?(.*)$/,
    callout: /^>\s*\[!(\w+)\]\s*$/,
    divider: /^(\s*)(-{3,}|\*{3,}|_{3,})\s*$/,
    tableRow: /^\|(.+)\|$/,
    tableSeparator: /^\|[\s\-:|]+\|$/,
    image: /^!\[([^\]]*)\]\(([^)]+)\)$/,
    blank: /^\s*$/
};
function tokenize(markdown) {
    const lines = markdown.split(/\r?\n/);
    const tokens = [];
    const state = {
        inCodeBlock: false,
        codeBlockFence: '',
        lineNumber: 0
    };
    for(let i = 0; i < lines.length; i++){
        state.lineNumber = i + 1;
        const line = lines[i];
        const token = tokenizeLine(line, state, lines, i);
        if (token) {
            tokens.push(token);
        }
    }
    return tokens;
}
function tokenizeLine(line, state, allLines, lineIndex) {
    const lineNumber = state.lineNumber;
    if (state.inCodeBlock) {
        const fenceMatch = line.match(PATTERNS.codeFence);
        if (fenceMatch && line.trim().startsWith(state.codeBlockFence.charAt(0))) {
            state.inCodeBlock = false;
            state.codeBlockFence = '';
            return {
                type: 'code_fence_end',
                raw: line,
                content: '',
                indent: 0,
                line: lineNumber
            };
        }
        return {
            type: 'code_content',
            raw: line,
            content: line,
            indent: 0,
            line: lineNumber
        };
    }
    const codeFenceMatch = line.match(PATTERNS.codeFence);
    if (codeFenceMatch) {
        state.inCodeBlock = true;
        state.codeBlockFence = codeFenceMatch[2];
        const language = codeFenceMatch[3] || '';
        return {
            type: 'code_fence_start',
            raw: line,
            content: '',
            indent: (codeFenceMatch[1] || '').length,
            line: lineNumber,
            meta: {
                language
            }
        };
    }
    if (PATTERNS.blank.test(line)) {
        return {
            type: 'blank',
            raw: line,
            content: '',
            indent: 0,
            line: lineNumber
        };
    }
    const dividerMatch = line.match(PATTERNS.divider);
    if (dividerMatch) {
        const prevLine = lineIndex > 0 ? allLines[lineIndex - 1] : '';
        if (prevLine.trim() && !PATTERNS.blank.test(prevLine)) {
            if (PATTERNS.setextH2.test(line)) {}
        } else {
            return {
                type: 'divider',
                raw: line,
                content: '',
                indent: (dividerMatch[1] || '').length,
                line: lineNumber
            };
        }
    }
    const headingMatch = line.match(PATTERNS.heading);
    if (headingMatch) {
        return {
            type: 'heading',
            raw: line,
            content: headingMatch[2].trim(),
            indent: 0,
            line: lineNumber,
            meta: {
                level: headingMatch[1].length
            }
        };
    }
    const calloutMatch = line.match(PATTERNS.callout);
    if (calloutMatch) {
        return {
            type: 'callout',
            raw: line,
            content: '',
            indent: 0,
            line: lineNumber,
            meta: {
                calloutType: calloutMatch[1].toLowerCase()
            }
        };
    }
    const blockquoteMatch = line.match(PATTERNS.blockquote);
    if (blockquoteMatch) {
        return {
            type: 'blockquote',
            raw: line,
            content: blockquoteMatch[1],
            indent: 0,
            line: lineNumber
        };
    }
    const checkListMatch = line.match(PATTERNS.checkList);
    if (checkListMatch) {
        const checked = checkListMatch[2].toLowerCase() === 'x';
        return {
            type: 'check_list_item',
            raw: line,
            content: checkListMatch[3],
            indent: checkListMatch[1].length,
            line: lineNumber,
            meta: {
                checked
            }
        };
    }
    const bulletMatch = line.match(PATTERNS.bulletList);
    if (bulletMatch) {
        return {
            type: 'bullet_list_item',
            raw: line,
            content: bulletMatch[3],
            indent: bulletMatch[1].length,
            line: lineNumber,
            meta: {
                listMarker: bulletMatch[2]
            }
        };
    }
    const numberedMatch = line.match(PATTERNS.numberedList);
    if (numberedMatch) {
        return {
            type: 'numbered_list_item',
            raw: line,
            content: numberedMatch[3],
            indent: numberedMatch[1].length,
            line: lineNumber,
            meta: {
                listIndex: parseInt(numberedMatch[2], 10)
            }
        };
    }
    if (PATTERNS.tableSeparator.test(line)) {
        return {
            type: 'table_separator',
            raw: line,
            content: line,
            indent: 0,
            line: lineNumber
        };
    }
    const tableRowMatch = line.match(PATTERNS.tableRow);
    if (tableRowMatch) {
        return {
            type: 'table_row',
            raw: line,
            content: tableRowMatch[1],
            indent: 0,
            line: lineNumber
        };
    }
    const imageMatch = line.match(PATTERNS.image);
    if (imageMatch) {
        return {
            type: 'image',
            raw: line,
            content: imageMatch[2],
            indent: 0,
            line: lineNumber,
            meta: {
                language: imageMatch[1]
            }
        };
    }
    if (PATTERNS.setextH1.test(line) || PATTERNS.setextH2.test(line)) {
        const prevLine = lineIndex > 0 ? allLines[lineIndex - 1] : '';
        if (prevLine.trim() && !PATTERNS.blank.test(prevLine)) {
            return {
                type: 'heading',
                raw: line,
                content: prevLine.trim(),
                indent: 0,
                line: lineNumber,
                meta: {
                    level: PATTERNS.setextH1.test(line) ? 1 : 2
                }
            };
        }
        return {
            type: 'divider',
            raw: line,
            content: '',
            indent: 0,
            line: lineNumber
        };
    }
    return {
        type: 'paragraph',
        raw: line,
        content: line.trim(),
        indent: line.length - line.trimStart().length,
        line: lineNumber
    };
}
function groupTokens(tokens) {
    const groups = [];
    let currentGroup = [];
    let lastType = null;
    for (const token of tokens){
        if (token.type === 'blank') {
            if (currentGroup.length > 0) {
                groups.push(currentGroup);
                currentGroup = [];
            }
            lastType = null;
            continue;
        }
        if (lastType === token.type) {
            currentGroup.push(token);
        } else {
            if (currentGroup.length > 0) {
                groups.push(currentGroup);
            }
            currentGroup = [
                token
            ];
            lastType = token.type;
        }
    }
    if (currentGroup.length > 0) {
        groups.push(currentGroup);
    }
    return groups;
}
function isListToken(token) {
    return token.type === 'bullet_list_item' || token.type === 'numbered_list_item' || token.type === 'check_list_item';
}
function isCodeToken(token) {
    return token.type === 'code_fence_start' || token.type === 'code_fence_end' || token.type === 'code_content';
}


//# sourceURL=packages/core/src/parsers/tokenizer.ts
__exports.tokenize=tokenize;
__exports.groupTokens=groupTokens;
__exports.isListToken=isListToken;
__exports.isCodeToken=isCodeToken;
},
"packages/core/src/parsers/inline.ts":function(__exports,__require){
function parseInlineContent(text) {
    if (!text) {
        return [];
    }
    const tokens = tokenizeInline(text);
    return tokensToSpans(tokens);
}
function tokenizeInline(text) {
    const tokens = [];
    let remaining = text;
    let pos = 0;
    while(pos < remaining.length){
        const matched = tryMatchInline(remaining, pos);
        if (matched) {
            if (matched.startIndex > pos) {
                tokens.push({
                    type: 'text',
                    content: remaining.slice(pos, matched.startIndex)
                });
            }
            tokens.push(matched.token);
            pos = matched.endIndex;
        } else {
            pos++;
        }
    }
    return parseInlineTokens(text);
}
function parseInlineTokens(text) {
    const tokens = [];
    let i = 0;
    let textBuffer = '';
    const flushText = ()=>{
        if (textBuffer) {
            tokens.push({
                type: 'text',
                content: textBuffer
            });
            textBuffer = '';
        }
    };
    while(i < text.length){
        if (text[i] === '\\' && i + 1 < text.length) {
            textBuffer += text[i + 1];
            i += 2;
            continue;
        }
        if (text[i] === '`') {
            const match = matchCode(text, i);
            if (match) {
                flushText();
                tokens.push(match.token);
                i = match.end;
                continue;
            }
        }
        if (text[i] === '[' || text[i] === '!' && text[i + 1] === '[') {
            const isImage = text[i] === '!';
            const match = matchLink(text, isImage ? i + 1 : i, isImage);
            if (match) {
                flushText();
                tokens.push(match.token);
                i = match.end;
                continue;
            }
        }
        if (text[i] === '*' || text[i] === '_') {
            const match = matchEmphasis(text, i);
            if (match) {
                flushText();
                tokens.push(match.token);
                i = match.end;
                continue;
            }
        }
        if (text[i] === '~' && text[i + 1] === '~') {
            const match = matchStrikethrough(text, i);
            if (match) {
                flushText();
                tokens.push(match.token);
                i = match.end;
                continue;
            }
        }
        if (text[i] === '=' && text[i + 1] === '=') {
            const match = matchHighlight(text, i);
            if (match) {
                flushText();
                tokens.push(match.token);
                i = match.end;
                continue;
            }
        }
        textBuffer += text[i];
        i++;
    }
    flushText();
    return tokens;
}
function matchCode(text, start) {
    let backticks = 0;
    let i = start;
    while(i < text.length && text[i] === '`'){
        backticks++;
        i++;
    }
    if (backticks === 0) return null;
    const closePattern = '`'.repeat(backticks);
    const closeIndex = text.indexOf(closePattern, i);
    if (closeIndex === -1) return null;
    if (text[closeIndex + backticks] === '`') {
        return null;
    }
    const content = text.slice(i, closeIndex);
    return {
        token: {
            type: 'code',
            content: content.trim()
        },
        end: closeIndex + backticks
    };
}
function matchLink(text, start, isImage = false) {
    if (text[start] !== '[') return null;
    let bracketDepth = 1;
    let i = start + 1;
    while(i < text.length && bracketDepth > 0){
        if (text[i] === '[') bracketDepth++;
        else if (text[i] === ']') bracketDepth--;
        else if (text[i] === '\\') i++;
        i++;
    }
    if (bracketDepth !== 0) return null;
    const linkText = text.slice(start + 1, i - 1);
    if (text[i] !== '(') return null;
    const urlStart = i + 1;
    let urlEnd = urlStart;
    let parenDepth = 1;
    while(urlEnd < text.length && parenDepth > 0){
        if (text[urlEnd] === '(') parenDepth++;
        else if (text[urlEnd] === ')') parenDepth--;
        else if (text[urlEnd] === '\\') urlEnd++;
        urlEnd++;
    }
    if (parenDepth !== 0) return null;
    const urlPart = text.slice(urlStart, urlEnd - 1).trim();
    let url = urlPart;
    let title;
    const titleMatch = urlPart.match(/^(.+?)\s+["'](.+?)["']$/);
    if (titleMatch) {
        url = titleMatch[1];
        title = titleMatch[2];
    }
    const children = parseInlineTokens(linkText);
    const token = isImage ? {
        type: 'image',
        content: linkText,
        url,
        title,
        children
    } : {
        type: 'link',
        content: linkText,
        url,
        title,
        children
    };
    return {
        token,
        end: isImage ? urlEnd + 1 : urlEnd
    };
}
function matchEmphasis(text, start) {
    const char = text[start];
    if (char !== '*' && char !== '_') return null;
    let count = 0;
    let i = start;
    while(i < text.length && text[i] === char && count < 3){
        count++;
        i++;
    }
    if (count === 0) return null;
    const closePattern = char.repeat(count);
    let searchStart = i;
    while(searchStart < text.length){
        const closeIndex = text.indexOf(closePattern, searchStart);
        if (closeIndex === -1) return null;
        if (text[closeIndex + count] === char) {
            searchStart = closeIndex + 1;
            continue;
        }
        if (text[closeIndex - 1] === ' ') {
            searchStart = closeIndex + 1;
            continue;
        }
        const content = text.slice(i, closeIndex);
        if (!content.trim()) {
            searchStart = closeIndex + 1;
            continue;
        }
        const children = parseInlineTokens(content);
        if (count === 3) {
            return {
                token: {
                    type: 'bold',
                    content,
                    children: [
                        {
                            type: 'italic',
                            content,
                            children
                        }
                    ]
                },
                end: closeIndex + count
            };
        } else if (count === 2) {
            return {
                token: {
                    type: 'bold',
                    content,
                    children
                },
                end: closeIndex + count
            };
        } else {
            return {
                token: {
                    type: 'italic',
                    content,
                    children
                },
                end: closeIndex + count
            };
        }
    }
    return null;
}
function matchStrikethrough(text, start) {
    if (text[start] !== '~' || text[start + 1] !== '~') return null;
    const closeIndex = text.indexOf('~~', start + 2);
    if (closeIndex === -1) return null;
    const content = text.slice(start + 2, closeIndex);
    if (!content.trim()) return null;
    const children = parseInlineTokens(content);
    return {
        token: {
            type: 'strikethrough',
            content,
            children
        },
        end: closeIndex + 2
    };
}
function matchHighlight(text, start) {
    if (text[start] !== '=' || text[start + 1] !== '=') return null;
    const closeIndex = text.indexOf('==', start + 2);
    if (closeIndex === -1) return null;
    const content = text.slice(start + 2, closeIndex);
    if (!content.trim()) return null;
    const children = parseInlineTokens(content);
    return {
        token: {
            type: 'highlight',
            content,
            children
        },
        end: closeIndex + 2
    };
}
function tokensToSpans(tokens) {
    const spans = [];
    for (const token of tokens){
        const newSpans = tokenToSpans(token, {});
        spans.push(...newSpans);
    }
    return mergeAdjacentSpans(spans);
}
function tokenToSpans(token, inheritedStyles) {
    switch(token.type){
        case 'text':
            return [
                {
                    text: token.content,
                    styles: {
                        ...inheritedStyles
                    }
                }
            ];
        case 'bold':
            return processStyledToken(token, {
                ...inheritedStyles,
                bold: true
            });
        case 'italic':
            return processStyledToken(token, {
                ...inheritedStyles,
                italic: true
            });
        case 'code':
            return [
                {
                    text: token.content,
                    styles: {
                        ...inheritedStyles,
                        code: true
                    }
                }
            ];
        case 'strikethrough':
            return processStyledToken(token, {
                ...inheritedStyles,
                strikethrough: true
            });
        case 'highlight':
            return processStyledToken(token, {
                ...inheritedStyles,
                highlight: true
            });
        case 'link':
            return processStyledToken(token, {
                ...inheritedStyles,
                link: {
                    url: token.url || '',
                    title: token.title
                }
            });
        case 'image':
            return [
                {
                    text: `[image: ${token.content}]`,
                    styles: inheritedStyles
                }
            ];
        default:
            return [
                {
                    text: token.content,
                    styles: inheritedStyles
                }
            ];
    }
}
function processStyledToken(token, styles) {
    if (token.children && token.children.length > 0) {
        const spans = [];
        for (const child of token.children){
            spans.push(...tokenToSpans(child, styles));
        }
        return spans;
    }
    return [
        {
            text: token.content,
            styles
        }
    ];
}
function mergeAdjacentSpans(spans) {
    if (spans.length === 0) return [];
    const merged = [
        spans[0]
    ];
    for(let i = 1; i < spans.length; i++){
        const current = spans[i];
        const previous = merged[merged.length - 1];
        if (stylesEqual(current.styles, previous.styles)) {
            previous.text += current.text;
        } else {
            merged.push(current);
        }
    }
    return merged;
}
function stylesEqual(a, b) {
    return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strikethrough === b.strikethrough && a.code === b.code && a.highlight === b.highlight && linksEqual(a.link, b.link);
}
function linksEqual(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.url === b.url && a.title === b.title;
}
function tryMatchInline(text, pos) {
    const matchers = [
        ()=>matchCode(text, pos),
        ()=>matchEmphasis(text, pos),
        ()=>matchStrikethrough(text, pos),
        ()=>matchHighlight(text, pos)
    ];
    for (const match of matchers){
        const result = match();
        if (result) {
            return {
                token: result.token,
                startIndex: pos,
                endIndex: result.end
            };
        }
    }
    return null;
}
function extractPlainText(text) {
    const spans = parseInlineContent(text);
    return spans.map((s)=>s.text).join('');
}


//# sourceURL=packages/core/src/parsers/inline.ts
__exports.parseInlineContent=parseInlineContent;
__exports.extractPlainText=extractPlainText;
},
"packages/core/src/serializers/markdown.ts":function(__exports,__require){
const {spansToPlainText}=__require("packages/core/src/core/utils.ts");
const DEFAULT_OPTIONS = {
    lineEnding: '\n',
    listIndent: 2,
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletChar: '-',
    emphasisChar: '*'
};
function blocksToMarkdown(blocks, options = {}) {
    const opts = {
        ...DEFAULT_OPTIONS,
        ...options
    };
    const serializedBlocks = blocks.map((block, index)=>serializeBlock(block, 0, opts, index, blocks));
    return serializedBlocks.filter((s)=>s !== null).join(opts.lineEnding + opts.lineEnding);
}
function documentToMarkdown(doc, options = {}) {
    return blocksToMarkdown(doc.blocks, options);
}
function serializeBlock(block, depth, options, index = 0, siblings = []) {
    switch(block.type){
        case 'paragraph':
            return serializeParagraph(block, options);
        case 'heading':
            return serializeHeading(block, options);
        case 'bulletList':
            return serializeBulletList(block, depth, options);
        case 'numberedList':
            return serializeNumberedList(block, depth, options, index, siblings);
        case 'checkList':
            return serializeCheckList(block, depth, options);
        case 'codeBlock':
            return serializeCodeBlock(block, options);
        case 'blockquote':
            return serializeBlockquote(block, options);
        case 'table':
            return serializeTable(block, options);
        case 'image':
            return serializeImage(block);
        case 'divider':
            return '---';
        case 'callout':
            return serializeCallout(block, options);
        default:
            return serializeInlineContent(block.content, options);
    }
}
function serializeParagraph(block, options) {
    return serializeInlineContent(block.content, options);
}
function serializeHeading(block, options) {
    const level = block.props.level;
    const content = serializeInlineContent(block.content, options);
    if (options.headingStyle === 'setext' && (level === 1 || level === 2)) {
        const underline = level === 1 ? '=' : '-';
        return `${content}${options.lineEnding}${underline.repeat(content.length)}`;
    }
    return `${'#'.repeat(level)} ${content}`;
}
function serializeBulletList(block, depth, options) {
    const indent = ' '.repeat(depth * options.listIndent);
    const bullet = options.bulletChar;
    return block.children.map((child)=>{
        const content = serializeListItemContent(child, depth, options);
        return `${indent}${bullet} ${content}`;
    }).join(options.lineEnding);
}
function serializeNumberedList(block, depth, options, _blockIndex = 0, _siblings = []) {
    const indent = ' '.repeat(depth * options.listIndent);
    return block.children.map((child, index)=>{
        const content = serializeListItemContent(child, depth, options);
        return `${indent}${index + 1}. ${content}`;
    }).join(options.lineEnding);
}
function serializeCheckList(block, depth, options) {
    const indent = ' '.repeat(depth * options.listIndent);
    const checked = block.props.checked ? 'x' : ' ';
    const content = serializeInlineContent(block.content, options);
    return `${indent}- [${checked}] ${content}`;
}
function serializeListItemContent(item, depth, options) {
    if (item.children.length > 0) {
        const content = serializeInlineContent(item.content, options);
        const nestedContent = item.children.map((child, index)=>serializeBlock(child, depth + 1, options, index, item.children)).join(options.lineEnding);
        return `${content}${options.lineEnding}${nestedContent}`;
    }
    return serializeInlineContent(item.content, options);
}
function serializeCodeBlock(block, options) {
    const code = spansToPlainText(block.content);
    const language = block.props.language ?? '';
    if (options.codeBlockStyle === 'indented') {
        return code.split('\n').map((line)=>`    ${line}`).join(options.lineEnding);
    }
    return `\`\`\`${language}${options.lineEnding}${code}${options.lineEnding}\`\`\``;
}
function serializeBlockquote(block, options) {
    const content = serializeInlineContent(block.content, options);
    return content.split('\n').map((line)=>`> ${line}`).join(options.lineEnding);
}
function serializeImage(block) {
    const alt = block.props.alt ?? '';
    const url = block.props.url ?? '';
    const title = block.props.title;
    if (title) {
        return `![${alt}](${url} "${title}")`;
    }
    return `![${alt}](${url})`;
}
function serializeTable(block, options) {
    const { headers, rows, alignments } = block.props;
    const lineEnding = options.lineEnding;
    const columnWidths = headers.map((header, i)=>{
        const rowWidths = rows.map((row)=>(row[i] ?? '').length);
        return Math.max(header.length, ...rowWidths, 3);
    });
    const headerRow = headers.map((header, i)=>header.padEnd(columnWidths[i])).join(' | ');
    const separatorRow = headers.map((_, i)=>{
        const width = columnWidths[i];
        const alignment = alignments?.[i] ?? null;
        if (alignment === 'left') return `:${'-'.repeat(width - 1)}`;
        if (alignment === 'right') return `${'-'.repeat(width - 1)}:`;
        if (alignment === 'center') return `:${'-'.repeat(width - 2)}:`;
        return '-'.repeat(width);
    }).join(' | ');
    const dataRows = rows.map((row)=>row.map((cell, i)=>(cell ?? '').padEnd(columnWidths[i])).join(' | '));
    return [
        `| ${headerRow} |`,
        `| ${separatorRow} |`,
        ...dataRows.map((row)=>`| ${row} |`)
    ].join(lineEnding);
}
function serializeCallout(block, options) {
    const type = block.props.type.toUpperCase();
    const content = serializeInlineContent(block.content, options);
    const lineEnding = options.lineEnding;
    return `> [!${type}]${lineEnding}> ${content.split('\n').join(`${lineEnding}> `)}`;
}
function serializeInlineContent(spans, options) {
    return spans.map((span)=>serializeSpan(span, options)).join('');
}
function serializeSpan(span, options) {
    let text = span.text;
    const styles = span.styles;
    if (!hasStyles(styles)) {
        return text;
    }
    if (styles.code) {
        text = `\`${text}\``;
    }
    if (styles.highlight) {
        text = `==${text}==`;
    }
    if (styles.strikethrough) {
        text = `~~${text}~~`;
    }
    if (styles.bold && styles.italic) {
        const char = options.emphasisChar;
        text = `${char}${char}${char}${text}${char}${char}${char}`;
    } else {
        if (styles.italic) {
            const char = options.emphasisChar;
            text = `${char}${text}${char}`;
        }
        if (styles.bold) {
            const char = options.emphasisChar;
            text = `${char}${char}${text}${char}${char}`;
        }
    }
    if (styles.underline) {
        text = `<u>${text}</u>`;
    }
    if (styles.link) {
        const { url, title } = styles.link;
        if (title) {
            text = `[${text}](${url} "${title}")`;
        } else {
            text = `[${text}](${url})`;
        }
    }
    return text;
}
function hasStyles(styles) {
    return !!(styles.bold || styles.italic || styles.underline || styles.strikethrough || styles.code || styles.highlight || styles.link);
}
function stringify(blocks, options) {
    return blocksToMarkdown(blocks, options);
}


//# sourceURL=packages/core/src/serializers/markdown.ts
__exports.blocksToMarkdown=blocksToMarkdown;
__exports.documentToMarkdown=documentToMarkdown;
__exports.serializeBlock=serializeBlock;
__exports.serializeInlineContent=serializeInlineContent;
__exports.serializeSpan=serializeSpan;
__exports.stringify=stringify;
},
"packages/core/src/core/blocks.ts":function(__exports,__require){
const {generateId,plainContent,plainSpan}=__require("packages/core/src/core/utils.ts");
function createBlock(type, content = [], props = {}, children = []) {
    return {
        id: generateId(),
        type,
        content,
        children,
        props
    };
}
function text(content) {
    return plainSpan(content);
}
function bold(content) {
    return {
        text: content,
        styles: {
            bold: true
        }
    };
}
function italic(content) {
    return {
        text: content,
        styles: {
            italic: true
        }
    };
}
function code(content) {
    return {
        text: content,
        styles: {
            code: true
        }
    };
}
function strikethrough(content) {
    return {
        text: content,
        styles: {
            strikethrough: true
        }
    };
}
function underline(content) {
    return {
        text: content,
        styles: {
            underline: true
        }
    };
}
function highlight(content) {
    return {
        text: content,
        styles: {
            highlight: true
        }
    };
}
function link(content, url, title) {
    return {
        text: content,
        styles: {
            link: {
                url,
                title
            }
        }
    };
}
function styled(content, styles) {
    return {
        text: content,
        styles
    };
}
function spans(...textSpans) {
    return textSpans;
}
function paragraph(content) {
    const textContent = typeof content === 'string' ? plainContent(content) : content;
    return createBlock('paragraph', textContent, {});
}
function heading(level, content) {
    const textContent = typeof content === 'string' ? plainContent(content) : content;
    return createBlock('heading', textContent, {
        level
    });
}
const h1 = (content)=>heading(1, content);
const h2 = (content)=>heading(2, content);
const h3 = (content)=>heading(3, content);
const h4 = (content)=>heading(4, content);
const h5 = (content)=>heading(5, content);
const h6 = (content)=>heading(6, content);
function bulletList(items) {
    const children = items.map((item)=>{
        if (typeof item === 'string') {
            return paragraph(item);
        }
        if (Array.isArray(item)) {
            return paragraph(item);
        }
        return item;
    });
    return createBlock('bulletList', [], {}, children);
}
function numberedList(items) {
    const children = items.map((item)=>{
        if (typeof item === 'string') {
            return paragraph(item);
        }
        if (Array.isArray(item)) {
            return paragraph(item);
        }
        return item;
    });
    return createBlock('numberedList', [], {}, children);
}
function checkListItem(content, checked = false) {
    const textContent = typeof content === 'string' ? plainContent(content) : content;
    return createBlock('checkList', textContent, {
        checked
    });
}
function checkList(items) {
    return items.map((item)=>checkListItem(item.content, item.checked ?? false));
}
function codeBlock(code, language) {
    return createBlock('codeBlock', plainContent(code), {
        language
    });
}
function blockquote(content) {
    const textContent = typeof content === 'string' ? plainContent(content) : content;
    return createBlock('blockquote', textContent, {});
}
function divider() {
    return createBlock('divider', [], {});
}
function image(url, alt, options) {
    return createBlock('image', [], {
        url,
        alt,
        title: options?.title,
        width: options?.width,
        height: options?.height
    });
}
function callout(type, content) {
    const textContent = typeof content === 'string' ? plainContent(content) : content;
    return createBlock('callout', textContent, {
        type
    });
}
const infoCallout = (content)=>callout('info', content);
const warningCallout = (content)=>callout('warning', content);
const tipCallout = (content)=>callout('tip', content);
const dangerCallout = (content)=>callout('danger', content);
const noteCallout = (content)=>callout('note', content);
function table(headers, rows, alignments) {
    return createBlock('table', [], {
        headers,
        rows,
        alignments
    });
}
function appendContent(block, ...newSpans) {
    return {
        ...block,
        content: [
            ...block.content,
            ...newSpans
        ]
    };
}
function prependContent(block, ...newSpans) {
    return {
        ...block,
        content: [
            ...newSpans,
            ...block.content
        ]
    };
}
function setContent(block, content) {
    return {
        ...block,
        content
    };
}
function addChildren(block, ...newChildren) {
    return {
        ...block,
        children: [
            ...block.children,
            ...newChildren
        ]
    };
}
function updateProps(block, props) {
    return {
        ...block,
        props: {
            ...block.props,
            ...props
        }
    };
}


//# sourceURL=packages/core/src/core/blocks.ts
__exports.createBlock=createBlock;
__exports.text=text;
__exports.bold=bold;
__exports.italic=italic;
__exports.code=code;
__exports.strikethrough=strikethrough;
__exports.underline=underline;
__exports.highlight=highlight;
__exports.link=link;
__exports.styled=styled;
__exports.spans=spans;
__exports.paragraph=paragraph;
__exports.heading=heading;
__exports.h1=h1;
__exports.h2=h2;
__exports.h3=h3;
__exports.h4=h4;
__exports.h5=h5;
__exports.h6=h6;
__exports.bulletList=bulletList;
__exports.numberedList=numberedList;
__exports.checkListItem=checkListItem;
__exports.checkList=checkList;
__exports.codeBlock=codeBlock;
__exports.blockquote=blockquote;
__exports.divider=divider;
__exports.image=image;
__exports.callout=callout;
__exports.infoCallout=infoCallout;
__exports.warningCallout=warningCallout;
__exports.tipCallout=tipCallout;
__exports.dangerCallout=dangerCallout;
__exports.noteCallout=noteCallout;
__exports.table=table;
__exports.appendContent=appendContent;
__exports.prependContent=prependContent;
__exports.setContent=setContent;
__exports.addChildren=addChildren;
__exports.updateProps=updateProps;
},
"packages/preview/src/html-serializer.ts":function(__exports,__require){
async function lazyParse(markdown) {
    try {
        const core = await Promise.resolve(__require("packages/core/src/index.ts"));
        return core.parse(markdown);
    } catch  {
        throw new Error('@create-markdown/core is required for markdownToHTML(). ' + 'Install it as a dependency, or use applyPreviewTheme() with your own parser instead.');
    }
}
const DEFAULT_OPTIONS = {
    classPrefix: 'cm-',
    theme: 'github',
    linkTarget: '_blank',
    sanitize: false,
    plugins: [],
    customRenderers: {}
};
function resolveOptions(options) {
    return {
        ...DEFAULT_OPTIONS,
        ...options,
        plugins: options?.plugins ?? [],
        customRenderers: options?.customRenderers ?? {}
    };
}
function applySanitize(html, sanitize) {
    if (typeof sanitize === 'function') {
        return sanitize(html);
    }
    return html;
}
function blocksToHTML(blocks, options) {
    const opts = resolveOptions(options);
    const prefix = opts.classPrefix;
    let transformedBlocks = blocks;
    for (const plugin of opts.plugins){
        if (plugin.transformBlock) {
            transformedBlocks = transformedBlocks.map(plugin.transformBlock);
        }
    }
    const htmlParts = transformedBlocks.map((block)=>{
        for (const plugin of opts.plugins){
            if (plugin.renderBlock) {
                const result = plugin.renderBlock(block, ()=>renderBlock(block, opts));
                if (result !== null) {
                    return result;
                }
            }
        }
        const customRenderer = opts.customRenderers[block.type];
        if (customRenderer) {
            return customRenderer(block);
        }
        return renderBlock(block, opts);
    });
    let html = `<div class="${prefix}preview">${htmlParts.join('\n')}</div>`;
    html = applySanitize(html, opts.sanitize);
    return html;
}
async function markdownToHTML(markdown, options) {
    const blocks = await lazyParse(markdown);
    return blocksToHTML(blocks, options);
}
async function renderAsync(blocks, options) {
    const opts = resolveOptions(options);
    for (const plugin of opts.plugins){
        if (plugin.init) {
            await plugin.init();
        }
    }
    let html = blocksToHTML(blocks, options);
    for (const plugin of opts.plugins){
        if (plugin.postProcess) {
            html = await plugin.postProcess(html);
        }
    }
    return html;
}
function renderBlock(block, opts) {
    const prefix = opts.classPrefix;
    switch(block.type){
        case 'paragraph':
            return `<p class="${prefix}paragraph">${renderInlineContent(block.content, opts)}</p>`;
        case 'heading':
            return renderHeading(block, opts);
        case 'bulletList':
            return renderBulletList(block, opts);
        case 'numberedList':
            return renderNumberedList(block, opts);
        case 'checkList':
            return renderCheckList(block, opts);
        case 'codeBlock':
            return renderCodeBlock(block, opts);
        case 'blockquote':
            return `<blockquote class="${prefix}blockquote">${renderInlineContent(block.content, opts)}</blockquote>`;
        case 'table':
            return renderTable(block, opts);
        case 'image':
            return renderImage(block, opts);
        case 'divider':
            return `<hr class="${prefix}divider" />`;
        case 'callout':
            return renderCallout(block, opts);
        default:
            return `<div class="${prefix}unknown">${renderInlineContent(block.content, opts)}</div>`;
    }
}
function renderHeading(block, opts) {
    const prefix = opts.classPrefix;
    const level = block.props.level;
    const tag = `h${level}`;
    const content = renderInlineContent(block.content, opts);
    return `<${tag} class="${prefix}heading ${prefix}h${level}">${content}</${tag}>`;
}
function renderBulletList(block, opts) {
    const prefix = opts.classPrefix;
    const items = block.children.map((child)=>`<li>${renderInlineContent(child.content, opts)}</li>`).join('\n');
    return `<ul class="${prefix}bullet-list">\n${items}\n</ul>`;
}
function renderNumberedList(block, opts) {
    const prefix = opts.classPrefix;
    const items = block.children.map((child)=>`<li>${renderInlineContent(child.content, opts)}</li>`).join('\n');
    return `<ol class="${prefix}numbered-list">\n${items}\n</ol>`;
}
function renderCheckList(block, opts) {
    const prefix = opts.classPrefix;
    const checked = block.props.checked;
    const checkboxAttr = checked ? 'checked disabled' : 'disabled';
    const textClass = checked ? `${prefix}checked` : '';
    return `
<div class="${prefix}checklist-item">
  <input type="checkbox" ${checkboxAttr} />
  <span class="${textClass}">${renderInlineContent(block.content, opts)}</span>
</div>`.trim();
}
function renderCodeBlock(block, opts) {
    const prefix = opts.classPrefix;
    const code = block.content.map((span)=>span.text).join('');
    const language = block.props.language || '';
    const escapedCode = escapeHtml(code);
    const langClass = language ? ` language-${language}` : '';
    const dataLang = language ? ` data-language="${language}"` : '';
    return `<pre class="${prefix}code-block"${dataLang}><code class="${prefix}code${langClass}">${escapedCode}</code></pre>`;
}
function renderTable(block, opts) {
    const prefix = opts.classPrefix;
    const { headers, rows, alignments } = block.props;
    const getStyle = (index)=>{
        const align = alignments?.[index];
        return align ? ` style="text-align: ${align}"` : '';
    };
    const headerRow = headers.length > 0 ? `<thead><tr>${headers.map((h, i)=>`<th${getStyle(i)}>${escapeHtml(h)}</th>`).join('')}</tr></thead>` : '';
    const bodyRows = rows.map((row)=>`<tr>${row.map((cell, i)=>`<td${getStyle(i)}>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('\n');
    return `<table class="${prefix}table">\n${headerRow}\n<tbody>\n${bodyRows}\n</tbody>\n</table>`;
}
function renderImage(block, opts) {
    const prefix = opts.classPrefix;
    const { url, alt, title, width, height } = block.props;
    const altAttr = alt ? ` alt="${escapeHtml(alt)}"` : ' alt=""';
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    const widthAttr = width ? ` width="${width}"` : '';
    const heightAttr = height ? ` height="${height}"` : '';
    const img = `<img src="${escapeHtml(url)}"${altAttr}${titleAttr}${widthAttr}${heightAttr} />`;
    const caption = alt ? `<figcaption>${escapeHtml(alt)}</figcaption>` : '';
    return `<figure class="${prefix}image">${img}${caption}</figure>`;
}
function renderCallout(block, opts) {
    const prefix = opts.classPrefix;
    const type = block.props.type;
    const content = renderInlineContent(block.content, opts);
    return `
<div class="${prefix}callout ${prefix}callout-${type}" role="alert">
  <strong class="${prefix}callout-title">${type}</strong>
  <div class="${prefix}callout-content">${content}</div>
</div>`.trim();
}
function renderInlineContent(spans, opts) {
    return spans.map((span)=>renderSpan(span, opts)).join('');
}
function renderSpan(span, opts) {
    let html = escapeHtml(span.text);
    const styles = span.styles;
    if (styles.code) {
        html = `<code>${html}</code>`;
    }
    if (styles.highlight) {
        html = `<mark>${html}</mark>`;
    }
    if (styles.strikethrough) {
        html = `<del>${html}</del>`;
    }
    if (styles.underline) {
        html = `<u>${html}</u>`;
    }
    if (styles.italic) {
        html = `<em>${html}</em>`;
    }
    if (styles.bold) {
        html = `<strong>${html}</strong>`;
    }
    if (styles.link) {
        const target = opts.linkTarget === '_blank' ? ' target="_blank" rel="noopener noreferrer"' : '';
        const title = styles.link.title ? ` title="${escapeHtml(styles.link.title)}"` : '';
        html = `<a href="${escapeHtml(styles.link.url)}"${title}${target}>${html}</a>`;
    }
    return html;
}
function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}


//# sourceURL=packages/preview/src/html-serializer.ts
__exports.blocksToHTML=blocksToHTML;
__exports.markdownToHTML=markdownToHTML;
__exports.renderAsync=renderAsync;
}};const cache={};function __require(id){if(cache[id])return cache[id];const out=cache[id]={};factories[id](out,__require);return out}window.OpenSesameMarkdown={...__require("packages/core/src/index.ts"),...__require("packages/preview/src/html-serializer.ts")};})();
