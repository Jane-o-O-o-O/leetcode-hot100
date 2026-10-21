import assert from 'node:assert/strict';
import test from 'node:test';
import { md } from './md.js';

test('C++ fences mark the language and exclude the fence label from code', () => {
  const code = '#include <vector>\nint main() { return 0; }';
  for (const language of ['c++', 'cpp']) {
    assert.equal(
      md(`\`\`\`${language}\n${code}\n\`\`\``),
      '<pre data-lang="cpp"><code>#include &lt;vector&gt;\nint main() { return 0; }</code></pre>',
    );
  }
});

test('C++ fences preserve example identifiers and runnable C++ behavior', () => {
  assert.equal(
    md('```c++#cpp-example\nint answer = 42;\n```'),
    '<pre data-lang="cpp" data-example-id="cpp-example"><code>int answer = 42;</code></pre>',
  );
  assert.equal(
    md('```run-cpp#run-example\nstd::cout << "hello";\n```'),
    '<pre data-lang="cpp" data-run="cpp" data-example-id="run-example"><code>std::cout &lt;&lt; &quot;hello&quot;;</code></pre>',
  );
});
