package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/s4y/go-sse"
)

// https://stackoverflow.com/a/31832326/84745
var src = rand.NewSource(time.Now().UnixNano())

const letterBytes = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
const (
	letterIdxBits = 6                    // 6 bits to represent a letter index
	letterIdxMask = 1<<letterIdxBits - 1 // All 1-bits, as many as letterIdxBits
	letterIdxMax  = 63 / letterIdxBits   // # of letter indices fitting in 63 bits
)

func RandStringBytesMaskImprSrc(n int) string {
	b := make([]byte, n)
	// A src.Int63() generates 63 random bits, enough for letterIdxMax characters!
	for i, cache, remain := n-1, src.Int63(), letterIdxMax; i >= 0; {
		if remain == 0 {
			cache, remain = src.Int63(), letterIdxMax
		}
		if idx := int(cache & letterIdxMask); idx < len(letterBytes) {
			b[i] = letterBytes[idx]
			i--
		}
		cache >>= letterIdxBits
		remain--
	}

	return string(b)
}

type TalkerState struct {
	Name    string `json:"name"`
	Message string `json:"message"`

	seq int
}

var talkers = make(map[string]TalkerState)
var priv2pub = make(map[string]string)
var maptasks = make(chan func())

func main() {
	host := "127.0.0.1:8080"
	fmt.Printf("http://%s/\n", host)

	ln, err := net.Listen("tcp", host)
	if err != nil {
		log.Fatal(err)
	}

	fileServer := http.FileServer(http.Dir("."))

	sseServer := sse.SSEServer{}
	sseServer.Start()

	// IRL, this detects gone connections. Otherwise they aren't detected as gone
	// until something sends them a message. Nothing handles this on the client
	// side, it just tickles the TCP socket enough that it's detected as closed.
	go func() {
		for {
			sseServer.Broadcast("ping", "")
			time.Sleep(30 * time.Second)
		}
	}()

	// Map worker. Need lotsa refecotring at this point, srsly.
	go func() {
		for task := range maptasks {
			task()
		}
	}()

	log.Fatal(http.Serve(ln, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			if r.URL.Path == "/talk" {
				var name string
				if name = r.URL.Query().Get("name"); name != "" {
				} else {
					return
				}
				privId := r.URL.Query().Get("key")
				pubId := priv2pub[privId]
				if pubId == "" {
					privId = RandStringBytesMaskImprSrc(12)
					pubId = RandStringBytesMaskImprSrc(12)
					maptasks <- func() {
						priv2pub[privId] = pubId
						talkers[pubId] = TalkerState{Name: name}

						msg, _ := json.Marshal(struct {
							Id    string      `json:"id"`
							State TalkerState `json:"state"`
						}{pubId, talkers[pubId]})
						sseServer.Broadcast("talker", string(msg))
					}
				}
				sseServer.ServeHTTPCB(w, r, func(client sse.Client) {
					for k, v := range talkers {
						msg, _ := json.Marshal(struct {
							Id    string      `json:"id"`
							State TalkerState `json:"state"`
						}{k, v})
						sseServer.Emit([]sse.Client{client}, "talker", string(msg))
					}
					msg, _ := json.Marshal(struct {
						Key string `json:"key"`
						Id  string `json:"id"`
					}{privId, pubId})
					sseServer.Emit([]sse.Client{client}, "key", string(msg))
				})
				maptasks <- func() {
					delete(talkers, pubId)
					delete(priv2pub, privId)
					sseServer.Broadcast("left", pubId)
				}
				return
			}
		case "POST":
			if r.URL.Path == "/msg" {
				if err := r.ParseForm(); err != nil {
					return
				}
				pubId := priv2pub[r.PostFormValue("key")]
				if pubId == "" {
					return
				}
				maptasks <- func() {
					seq, _ := strconv.Atoi(r.PostFormValue("seq"))
					talker := talkers[pubId]
					if seq <= talker.seq {
						return
					}
					talker.seq = seq
					talker.Message = r.PostFormValue("message")
					talkers[pubId] = talker
					msg, _ := json.Marshal(struct {
						Id    string      `json:"id"`
						State TalkerState `json:"state"`
					}{pubId, talker})
					sseServer.Broadcast("talker", string(msg))
				}
				return
			}
		}
		fileServer.ServeHTTP(w, r)
	})))
}
