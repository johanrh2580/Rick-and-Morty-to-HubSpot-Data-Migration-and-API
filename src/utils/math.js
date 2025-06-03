// src/utils/math.js

/**
 * Checks if a given number is a prime number.
 * @param {number} num - The number to check for primality.
 * @returns {boolean} - True if the number is prime, False otherwise.
 */
function isPrime(num) {
  // Numbers less than or equal to 1 are not prime.
  if (num <= 1) return false;
  // 2 and 3 are prime numbers.
  if (num <= 3) return true;

  // If the number is divisible by 2 or 3, it's not prime.
  if (num % 2 === 0 || num % 3 === 0) return false;

  // Optimization: Check for divisors from 5 up to the square root of num.
  // We only need to check numbers of the form 6k +/- 1 because all primes greater than 3 are of this form.
  for (let i = 5; i * i <= num; i += 6) {
    if (num % i === 0 || num % (i + 2) === 0) {
      return false;
    }
  }
  return true;
}

module.exports = {
  isPrime,
};