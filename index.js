var fs = require("fs");
var dgram = require("dgram");
var udp = dgram.createSocket("udp4");
var osc = require("osc-min");
var child_process = require("child_process");
console.log("Please run me with SUDO");

function tryParse(t) {
  try {
    return JSON.parse(t);
  } catch (e) {
    return undefined;
  }
}

var cnf = `
rdr on en0 inet proto tcp to any port 80 -> 127.0.0.1 port 8090
rdr on en0 inet proto tcp to any port 443 -> 127.0.0.1 port 8080
`;

try {
  fs.mkdirSync("runtime");
} catch (e) {}
try {
  fs.unlinkSync("./runtime/out.log");
} catch (e) {}
try {
  fs.writeFileSync("./runtime/pf.conf", cnf);
} catch (e) {}

try {
  child_process.execSync("killall sslsplit");
} catch (e) {}
child_process.execSync("pfctl -f ./runtime/pf.conf");
try {
  child_process.execSync("pfctl -d");
} catch (e) {}
child_process.execSync("pfctl -e");

var cmd = `/usr/local/bin/sslsplit`;
var reader = `tail`;

var sslsplit = child_process.spawn(
  cmd,
  `-L ./runtime/out.log -k ./ca/mitmproxy-ca.pem -c ./ca/mitmproxy-ca-cert.pem https 0.0.0.0 8080 http 0.0.0.0 8090`.split(
    " "
  )
);
sslsplit.stderr.on("data", function(d) {
  // console.log(d.toString());
});
console.log("Starting in 2 for cpu sake");

var sticky = "";
var utf8 = /\\u([\d\w]{4})/gi;
function decode(x) {
  x = x.replace(utf8, function(match, grp) {
    return String.fromCharCode(parseInt(grp, 16));
  });
  return x;
}

var imageCapture = 0;
var imgbuf = "";

setTimeout(function() {
  console.log("Running");
  var rd = child_process.spawn(reader, `-f ./runtime/out.log`.split(" "));
  rd.stdout.on("data", function(d) {
    // return;
    var s = d.toString();
    // console.log(d.toString());
    var j = s.split("\n");
    var toParse = undefined;
    for (var i = 0; i < j.length; i++) {
      var dD = String(j[i]).trim();
      // return;
      if (/UTC\s\[.+?\]\:.+?\-\>\s\[.+?\]\:/gi.test(dD)) {
        //console.log("UTC SHIT");
        continue;
      }
     
      //search for { and chop the head off!!!
      // if(j[i].indexOf("GET ") == 0) {
      //   console.log(j[i].substring(4));
      // }
      if (/\"dst\"\:\".+\"\,/.test(j[i])) {
        //图像识别
        var m;
        var jb = /\"dst\"\:\"(.*?)\"\,/g;
        while ((m = jb.exec(j[i]))) {
          console.log(decode(m[1]));
        }
        break;
      }

      var head = j[i].indexOf('{"');
      //   var tail = j[i].indexOf('"}');
      //   if (head == -1 && tail == -1) {
      //     if (j[i].indexOf(" -> ") > 0) {
      //       console.log(j[i]);
      //       continue;
      //     }
      //     sticky = "";
      //     continue;
      //   }
      //   if (sticky == "") {
      j[i] = j[i].substring(head);
      //   }
      //   sticky += j[i];
      //   console.log("CHOP", sticky);
      //   var q = tryParse(sticky);
      //   if (q) {
      //     console.log(q);
      //     sticky = "";
      //     break;
      //   }

      //   console.log(j[i]);
      if (/corpus_no/.test(j[i])) {
        //clean junk
        toParse = j[i];
        break;
      } else if (/trans_result/.test(j[i])) {
        //clean junk
        console.log(j[i].substring(0, j[i].length - 6))
        toParse = j[i].substring(0, j[i].length - 6);
        break;
      } else if (/\"old_from\":/.test(j[i])) {
        var patcher = j[i].indexOf(',"old_from":');
        j[i] = j[i].substring(0, patcher) + "}"; //finish json
        toParse = j[i];
        break;
      }
    }
    if (toParse) {
      try {
        var o = JSON.parse(toParse);
        console.log(JSON.stringify(o));
        if(o["trans_result"]) {
          console.log(JSON.stringify(o));
          send({
            address: "/translation",
            args: [
              new Buffer(o.trans_result[0].dst, "utf8"),
              {
                type: "integer",
                value: o.from == "en" ? 1 : 0
              }
            ]
          });
        }
        else if (o.content && o.content.item && o.content.item[0]) {
          // console.log(o.content.item[0]);
          send({
            address: "/conversation",
            args: [new Buffer(o.content.item[0], "utf8")]
          });
        } else if (o.fanyi) {
          // console.log(o.fanyi, o.from == "en");
          send({
            address: "/translation",
            args: [
              new Buffer(o.fanyi, "utf8"),
              {
                type: "integer",
                value: o.from == "en" ? 1 : 0
              }
            ]
          });
        } else if (o.idxs && o.idxs[0] && o.idxs[0].content) {
          var idxs = o.idxs[0].content;
          var _idxs = "";
          for (var i = 0; i < idxs.length; i++) {
            _idxs += Object.keys(idxs[i][0])[0];
          }
          // console.log("idxs:", _idxs);
          send({
            address: "/conversation",
            args: [new Buffer(_idxs, "utf8")]
          });
        } else if (o.corpus_no && o.result) {
          var word = (o.result.uncertain_word || o.result.word)[0];
          send({
            address: "/voice",
            args: [new Buffer(word, "utf8")]
          });
        }
      } catch (e) {
        console.log(e);
      }
    }
  });
}, 2000);

send = function(obj) {
  var buf;
  buf = osc.toBuffer(obj);
  console.log("Sending", buf);
  return udp.send(buf, 0, buf.length, 12000, "localhost");
};
