import { resolveAnswerToAction } from '../../lib/form-ai-ollama.js';

describe('form-ai-ollama', () => {
  test('resolveAnswerToAction maps radio by number', () => {
    const field = {
      type: 'radio',
      question: 'Q1',
      options: [{ label: 'A', ref: 'e1' }, { label: 'B', ref: 'e2' }],
    };
    expect(resolveAnswerToAction(field, '2')).toEqual({ kind: 'click', ref: 'e2' });
  });

  test('resolveAnswerToAction maps textbox', () => {
    const field = { type: 'textbox', question: 'Name', ref: 'e3' };
    expect(resolveAnswerToAction(field, 'Alice')).toEqual({
      kind: 'type',
      ref: 'e3',
      text: 'Alice',
    });
  });
});
