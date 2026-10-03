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
});
