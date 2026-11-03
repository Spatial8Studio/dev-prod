package com.spatia.studio;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class CommunityService {
    private final AuthService auth;
    private final Map<String, ProjectRecord> projects = new ConcurrentHashMap<>();
    private final Map<String, Set<String>> followersByArtist = new ConcurrentHashMap<>();

    public CommunityService(AuthService auth) {
        this.auth = auth;
    }

    public ProjectView create(ProjectRequest request, String userId) {
        String title = clean(request == null ? null : request.title());
        if (title.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Project title is required");
        }
        if (request.scene() == null || request.scene().sources() == null || request.scene().sources().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A project needs at least one audio source");
        }
        String mode = "fixed".equalsIgnoreCase(request.mode()) ? "fixed" : "animated";
        Instant now = Instant.now();
        ProjectRecord project = new ProjectRecord(
            UUID.randomUUID().toString(), title, clean(request.description()), mode,
            request.published(), userId, request.scene(), request.assetNames() == null ? Map.of() : Map.copyOf(request.assetNames()),
            clean(request.renderId()), now, now
        );
        projects.put(project.id(), project);
        return view(project, userId);
    }

    public List<ProjectView> mine(String userId) {
        return projects.values().stream()
            .filter(project -> project.ownerId().equals(userId))
            .sorted(Comparator.comparing(ProjectRecord::updatedAt).reversed())
            .map(project -> view(project, userId))
            .toList();
    }

    public List<ProjectView> discover(String query, String userId) {
        String normalized = clean(query).toLowerCase();
        return projects.values().stream()
            .filter(ProjectRecord::published)
            .filter(project -> normalized.isBlank()
                || project.title().toLowerCase().contains(normalized)
                || project.description().toLowerCase().contains(normalized)
                || ownerName(project.ownerId()).toLowerCase().contains(normalized))
            .sorted(Comparator.comparing(ProjectRecord::updatedAt).reversed())
            .map(project -> view(project, userId))
            .toList();
    }

    public ProjectView setPublished(String id, boolean published, String userId) {
        ProjectRecord project = owned(id, userId);
        ProjectRecord updated = new ProjectRecord(project.id(), project.title(), project.description(), project.mode(),
            published, project.ownerId(), project.scene(), project.assetNames(), project.renderId(), project.createdAt(), Instant.now());
        projects.put(id, updated);
        return view(updated, userId);
    }

    public String publicRenderId(String id) {
        ProjectRecord project = projects.get(id);
        if (project == null || !project.published() || project.renderId().isBlank()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Published project audio not found");
        }
        return project.renderId();
    }

    public List<ArtistView> artists(String query, String userId) {
        String normalized = clean(query).toLowerCase();
        return auth.accounts().stream()
            .filter(account -> !account.id().equals(userId))
            .filter(account -> normalized.isBlank()
                || account.name().toLowerCase().contains(normalized)
                || account.email().toLowerCase().contains(normalized))
            .sorted(Comparator.comparing(AuthService.Account::name))
            .map(account -> artist(account.id(), userId))
            .toList();
    }

    public ArtistView follow(String artistId, String userId) {
        if (artistId.equals(userId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "You cannot follow yourself");
        }
        AuthService.Account artist = auth.accountById(artistId);
        if (artist == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Artist not found");
        }
        followersByArtist.computeIfAbsent(artistId, ignored -> ConcurrentHashMap.newKeySet()).add(userId);
        return artist(artistId, userId);
    }

    public ArtistView unfollow(String artistId, String userId) {
        Set<String> followers = followersByArtist.get(artistId);
        if (followers != null) followers.remove(userId);
        AuthService.Account artist = auth.accountById(artistId);
        if (artist == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Artist not found");
        return artist(artistId, userId);
    }

    private ProjectRecord owned(String id, String userId) {
        ProjectRecord project = projects.get(id);
        if (project == null || !project.ownerId().equals(userId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found");
        }
        return project;
    }

    private ProjectView view(ProjectRecord project, String viewerId) {
        AuthService.Account owner = auth.accountById(project.ownerId());
        UserView ownerView = owner == null ? new UserView(project.ownerId(), "", "Unknown artist")
            : new UserView(owner.id(), owner.email(), owner.name());
        return new ProjectView(project.id(), project.title(), project.description(), project.mode(), project.published(),
            ownerView, project.scene(), project.assetNames(), project.renderId(), project.createdAt(), project.updatedAt());
    }

    private ArtistView artist(String artistId, String viewerId) {
        AuthService.Account account = auth.accountById(artistId);
        Set<String> followers = followersByArtist.getOrDefault(artistId, Set.of());
        return new ArtistView(account.id(), account.name(), account.email(), followers.size(), followers.contains(viewerId));
    }

    private String ownerName(String id) {
        AuthService.Account account = auth.accountById(id);
        return account == null ? "" : account.name();
    }

    private String clean(String value) {
        return value == null ? "" : value.trim();
    }

    private record ProjectRecord(String id, String title, String description, String mode, boolean published,
                                 String ownerId, SceneRequest scene, Map<String, String> assetNames,
                                 String renderId, Instant createdAt, Instant updatedAt) {}
}
