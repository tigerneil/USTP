(function(global) {
    const MODEL_NAME = 'gemini-3-pro-preview';
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`;
    const MAX_SOURCE_CHARS = 40000;
    const MAX_RETRIES = 5;
    const MAX_OUTPUT_TOKENS = 4096;
    const MAX_CONTINUATION_PASSES = 6;

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function normalizeContent(content) {
        return String(content || '')
            .replace(/\r/g, '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function prepareSourceContent(content) {
        const normalizedContent = normalizeContent(content);
        if (normalizedContent.length <= MAX_SOURCE_CHARS) {
            return {
                text: normalizedContent,
                wasTruncated: false
            };
        }

        return {
            text: normalizedContent.slice(0, MAX_SOURCE_CHARS),
            wasTruncated: true
        };
    }

    function buildSkillPrompt(page) {
        const preparedSource = prepareSourceContent(page.content);
        const truncationNote = preparedSource.wasTruncated
            ? 'The source content was truncated to fit the model context window. Mention any uncertainty caused by truncation in Constraints.'
            : 'The source content is complete as provided.';

        return `You convert webpage content into a reusable skill file for an AI agent.

Return markdown only.
Do not wrap the result in code fences.
Ground every instruction in the provided source.
If a detail is missing from the source, write "Not specified in source."
Prefer short imperative bullets over long prose.

Use this exact section structure:
# <Skill Name>

## Purpose

## When to Use

## Required Inputs

## Workflow

## Constraints

## Output

## Source

The Workflow section must be a numbered list.
The Source section must include the page title and URL as bullet points.

Page title: ${page.title || 'Untitled page'}
Page URL: ${page.url}
Source status: ${truncationNote}

Source content:
${preparedSource.text}`;
    }

    function buildPdfSkillPrompt(page) {
        const pdfSource = page.documentSource;
        return `You convert PDF content into a reusable skill file for an AI agent.

Return markdown only.
Do not wrap the result in code fences.
Ground every instruction in the provided PDF.
If a detail is missing from the PDF, write "Not specified in source."
Prefer short imperative bullets over long prose.

Use this exact section structure:
# <Skill Name>

## Purpose

## When to Use

## Required Inputs

## Workflow

## Constraints

## Output

## Source

The Workflow section must be a numbered list.
The Source section must include the page title and URL as bullet points.
If the PDF may have been trimmed for transport size, mention that in Constraints.

Page title: ${page.title || 'Untitled PDF'}
Page URL: ${page.url}
Source type: PDF
PDF size: ${pdfSource.sizeBytes || 0} bytes`;
    }

    function buildInitialSkillParts(page) {
        if (page.documentSource?.kind === 'pdf') {
            return [
                {
                    inline_data: {
                        mime_type: page.documentSource.mimeType || 'application/pdf',
                        data: page.documentSource.data
                    }
                },
                {
                    text: buildPdfSkillPrompt(page)
                }
            ];
        }

        return [{
            text: buildSkillPrompt(page)
        }];
    }

    async function requestGeminiContent(contents, apiKey) {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
            const response = await fetch(`${API_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: contents,
                    generationConfig: {
                        temperature: 0.4,
                        topK: 32,
                        topP: 0.9,
                        maxOutputTokens: MAX_OUTPUT_TOKENS
                    }
                })
            });

            if (response.status === 429 && attempt < MAX_RETRIES - 1) {
                await delay((2 ** attempt) * 1000);
                continue;
            }

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Gemini request failed (${response.status}): ${errorBody}`);
            }

            const data = await response.json();
            const candidate = data.candidates?.[0];
            const text = data.candidates?.[0]?.content?.parts
                ?.map((part) => part.text || '')
                .join('') || '';

            if (!text.trim()) {
                throw new Error('Gemini returned an empty response while generating the skill.');
            }

            return {
                text: text,
                finishReason: candidate?.finishReason || 'STOP'
            };
        }

        throw new Error('Gemini rate limit persisted after multiple retries.');
    }

    async function requestCompleteSkillMarkdown(initialParts, apiKey) {
        const contents = [{
            role: 'user',
            parts: initialParts
        }];
        let combinedMarkdown = '';

        for (let pass = 0; pass < MAX_CONTINUATION_PASSES; pass += 1) {
            const result = await requestGeminiContent(contents, apiKey);
            combinedMarkdown += result.text;
            contents.push({
                role: 'model',
                parts: [{
                    text: result.text
                }]
            });

            if (result.finishReason !== 'MAX_TOKENS') {
                return combinedMarkdown;
            }

            contents.push({
                role: 'user',
                parts: [{
                    text: 'Continue the same SKILL.md from the exact point you stopped. Do not repeat any previous text. Output only the remaining markdown.'
                }]
            });
        }

        throw new Error('Gemini kept truncating the generated skill after multiple continuation attempts.');
    }

    function stripCodeFences(markdown) {
        const fencedMatch = markdown.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/i);
        if (fencedMatch) {
            return fencedMatch[1].trim();
        }

        return markdown.trim();
    }

    function extractSkillName(markdown) {
        const headingMatch = markdown.match(/^#\s+(.+)$/m);
        return headingMatch ? headingMatch[1].trim() : '';
    }

    function slugify(value) {
        const normalizedValue = String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        return normalizedValue || 'webpage-skill';
    }

    async function generateSkillFromPage(page) {
        if (!page || !page.url) {
            throw new Error('A page URL is required to generate a skill.');
        }

        if (!page.apiKey) {
            throw new Error('A Gemini API key is required to generate a skill.');
        }

        if (!page.documentSource?.kind && !normalizeContent(page.content)) {
            throw new Error('No webpage content was available to transform into a skill.');
        }

        if (page.documentSource?.kind === 'pdf' && !page.documentSource.data) {
            throw new Error('PDF data was missing while generating the skill.');
        }

        const initialParts = buildInitialSkillParts(page);
        const rawMarkdown = await requestCompleteSkillMarkdown(initialParts, page.apiKey);
        const markdown = stripCodeFences(rawMarkdown);
        const skillName = extractSkillName(markdown) || page.title || 'Webpage Skill';

        return {
            skillName: skillName,
            fileName: `${slugify(skillName)}-SKILL.md`,
            markdown: markdown
        };
    }

    global.USTPPageSkillModule = Object.freeze({
        generateSkillFromPage: generateSkillFromPage
    });
})(window);
