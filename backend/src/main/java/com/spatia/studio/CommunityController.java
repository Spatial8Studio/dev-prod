package com.spatia.studio;

import org.springframework.core.io.FileSystemResource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.nio.file.Path;
import java.util.List;

@RestController
@RequestMapping("/api")
public class CommunityController {
    private final AuthService auth;
    private final CommunityService community;
    private final AudioService audio;

    public CommunityController(AuthService auth, CommunityService community, AudioService audio) {
        this.auth = auth;
        this.community = community;
        this.audio = audio;
    }

    @PostMapping("/projects")
    public ProjectView createProject(@RequestHeader(value = "Authorization", required = false) String header,
                                     @RequestBody ProjectRequest request) {
        return community.create(request, auth.require(AuthController.token(header)).id());
    }

    @GetMapping("/projects/mine")
    public List<ProjectView> myProjects(@RequestHeader(value = "Authorization", required = false) String header) {
        return community.mine(auth.require(AuthController.token(header)).id());
    }

    @GetMapping("/projects/discover")
    public List<ProjectView> discover(@RequestHeader(value = "Authorization", required = false) String header,
                                     @RequestParam(defaultValue = "") String q) {
        return community.discover(q, auth.require(AuthController.token(header)).id());
    }

    @PostMapping("/projects/{id}/publish")
    public ProjectView publish(@RequestHeader(value = "Authorization", required = false) String header,
                               @PathVariable String id, @RequestBody PublishRequest request) {
        return community.setPublished(id, request.published(), auth.require(AuthController.token(header)).id());
    }

    @GetMapping("/projects/{id}/audio")
    public ResponseEntity<FileSystemResource> projectAudio(@PathVariable String id) {
        String renderId = community.publicRenderId(id);
        Path path = audio.renderFileForPublic(renderId);
        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + path.getFileName() + "\"")
            .body(new FileSystemResource(path));
    }

    @GetMapping("/artists")
    public List<ArtistView> artists(@RequestHeader(value = "Authorization", required = false) String header,
                                   @RequestParam(defaultValue = "") String q) {
        return community.artists(q, auth.require(AuthController.token(header)).id());
    }

    @PostMapping("/artists/{id}/follow")
    public ArtistView follow(@RequestHeader(value = "Authorization", required = false) String header,
                             @PathVariable String id) {
        return community.follow(id, auth.require(AuthController.token(header)).id());
    }

    @DeleteMapping("/artists/{id}/follow")
    public ArtistView unfollow(@RequestHeader(value = "Authorization", required = false) String header,
                               @PathVariable String id) {
        return community.unfollow(id, auth.require(AuthController.token(header)).id());
    }
}
