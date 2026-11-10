document.querySelectorAll('.toggle-password').forEach(button => {

  button.addEventListener('click', () => {

    const input = document.getElementById(button.dataset.target);

    if (input.type === 'password') {
      input.type = 'text';
      button.textContent = '🙈';
      button.setAttribute('aria-label', 'Hide password');
      button.setAttribute('aria-pressed', 'true');
    } else {
      input.type = 'password';
      button.textContent = '👁';
      button.setAttribute('aria-label', 'Show password');
      button.setAttribute('aria-pressed', 'false');
    }

  });

});