import { parseFormFields, findNavigation } from '../../lib/google-form-snapshot.js';

const SAMPLE = `- heading "Contact information" [level=1]
- button "Learn more" [e2]
    - heading "Name Required question" [level=3]: Name *
    - textbox "Name Required question" [e4]
    - heading "Email Required question" [level=3]: Email *
    - textbox "Email Required question" [e6]
    - heading "Phone number" [level=3]
    - textbox "Phone number" [e10]
- button "Submit" [e13]`;

describe('google-form-snapshot', () => {
  test('parses indented Google Form textboxes', () => {
    const fields = parseFormFields(SAMPLE);
    expect(fields).toHaveLength(3);
    expect(fields[0]).toMatchObject({ question: 'Name', type: 'textbox', ref: 'e4' });
    expect(fields[1]).toMatchObject({ question: 'Email', type: 'textbox', ref: 'e6' });
    expect(fields[2]).toMatchObject({ question: 'Phone number', type: 'textbox', ref: 'e10' });
  });

  test('finds Submit navigation ref', () => {
    expect(findNavigation(SAMPLE).submit).toBe('e13');
  });

  test('detects file-upload questions and numbers their Add file buttons in page order', () => {
    const snap = `    - heading "Name Required question" [level=3]: Name *
    - textbox "Name Required question" [e4]
    - heading "Passport photo Required question" [level=3]: Passport photo *
    - button "Add file" [e7]
    - heading "Marksheet" [level=3]
    - text: Upload 1 supported file: PDF. Max 10 MB.
    - button "Add file" [e9]
- button "Submit" [e12]`;
    const fields = parseFormFields(snap);
    expect(fields).toEqual([
      expect.objectContaining({ question: 'Name', type: 'textbox', ref: 'e4' }),
      expect.objectContaining({ question: 'Passport photo', type: 'file', ref: 'e7', fileIndex: 0 }),
      expect.objectContaining({ question: 'Marksheet', type: 'file', ref: 'e9', fileIndex: 1 }),
    ]);
  });

  test('detects live Google Forms file buttons named after the question (quoted, no ref)', () => {
    const snap = `- list:
  - listitem [e2]:
    - heading "Email Required question" [level=3]: Email *
    - textbox "Your email" [e3]
  - listitem [e6]:
    - 'heading "Please upload your file here (if applicable): Required question" [level=3]': "Please upload your file here (if applicable): *"
    - text: Upload 1 supported file. Max 10 MB.
    - list "Selected files"
    - 'button "Please upload your file here (if applicable): Required question"':
      - img
      - text: Add file
    - alert: This is a required question
- button "Submit" [e7]
- button "Clear form" [e8]`;
    const fields = parseFormFields(snap);
    expect(fields).toEqual([
      expect.objectContaining({ question: 'Your email', type: 'textbox', ref: 'e3' }),
      expect.objectContaining({
        question: 'Please upload your file here (if applicable):',
        type: 'file',
        ref: null,
        fileIndex: 0,
      }),
    ]);
  });

  test('ignores ordinary buttons without Add file text', () => {
    const snap = `- button "Clear form" [e8]:
  - text: Clear form
- button "Submit" [e7]`;
    expect(parseFormFields(snap).filter((f) => f.type === 'file')).toEqual([]);
  });
});
