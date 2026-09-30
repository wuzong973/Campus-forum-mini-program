
var fs = require("fs");
var s = fs.readFileSync("D:/校园论坛小程序/server/controllers/scheduleController.js","utf8");
var L = s.split(String.fromCharCode(10));
for (var i = 0; i < L.length; i++) {
  if (/exports\.refresh\b/.test(L[i])) {
    console.log("--- REFRESH at line " + (i+1) + " ---");
    for (var j = i; j < Math.min(L.length, i+55); j++) console.log((j+1) + ": " + L[j]);
    break;
  }
}
var failFn = L.findIndex(function(x) { return /^function fail/.test(x); });
console.log("--- fail() at " + (failFn+1) + " ---");
if (failFn >= 0) for (var j = failFn; j < Math.min(L.length, failFn+10); j++) console.log((j+1) + ": " + L[j]);
